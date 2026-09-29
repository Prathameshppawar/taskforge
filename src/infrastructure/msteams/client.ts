import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto'

import { prisma } from '@/infrastructure/db/prisma'
import { seal, unseal } from '@/infrastructure/github/secrets'
import { checkBotClaims, isTrustedServiceUrl } from '@/core/domain/msteams'

/**
 * Bot Framework over plain HTTPS — no SDK, as with the GitHub App client.
 *
 * Incoming: every request carries a JWT the Bot Connector signed; it is
 * verified against Bot Framework's published keys and the claim rules in
 * `checkBotClaims`, and nothing else in the request is trusted until it is.
 * Outgoing: a client-credentials token for the bot's app registration, cached
 * until shortly before it expires, sent only to Microsoft's own hosts.
 */

const KEY = 'msteams'
const OPENID = 'https://login.botframework.com/v1/.well-known/openidconfiguration'

/**
 * Local end-to-end testing without a Microsoft 365 tenant: a mock connector
 * and a test signing key. Only honoured when NODE_ENV is "development" — which
 * `next dev` sets and a deployment never does — so production always talks to
 * Microsoft and always checks Microsoft's keys.
 */
const DEV = process.env.NODE_ENV === 'development'
const TEST_CONNECTOR = DEV ? process.env.MSTEAMS_TEST_CONNECTOR : undefined
const TEST_JWKS = DEV ? process.env.MSTEAMS_TEST_JWKS : undefined

export function isAllowedServiceUrl(url: string): boolean {
  return isTrustedServiceUrl(url) || Boolean(TEST_CONNECTOR && url.startsWith(TEST_CONNECTOR))
}

export interface TeamsCredentials {
  appId: string
  password: string
  /** Set for a single-tenant bot, which is what Microsoft now creates. */
  tenantId: string | null
}

export async function saveTeamsCredentials(input: { appId: string; password: string | null; tenantId: string | null } | null) {
  if (!input) {
    await prisma.integrationSecret.deleteMany({ where: { key: KEY } })
    tokenCache = null
    return
  }
  const existing = await prisma.integrationSecret.findUnique({ where: { key: KEY } })
  const password = input.password ?? (existing ? unseal(existing.valueEnc) : null)
  if (!password) throw new Error('Enter the bot’s client secret.')
  const data = {
    valueEnc: seal(password),
    hint: password.slice(-4),
    meta: JSON.stringify({ appId: input.appId, tenantId: input.tenantId }),
  }
  await prisma.integrationSecret.upsert({ where: { key: KEY }, create: { key: KEY, ...data }, update: data })
  tokenCache = null
}

export async function teamsCredentials(): Promise<TeamsCredentials | null> {
  const row = await prisma.integrationSecret.findUnique({ where: { key: KEY } })
  if (!row?.meta) return null
  const meta = JSON.parse(row.meta) as { appId: string; tenantId: string | null }
  return { appId: meta.appId, tenantId: meta.tenantId, password: unseal(row.valueEnc) }
}

export async function teamsStatus() {
  const row = await prisma.integrationSecret.findUnique({ where: { key: KEY }, select: { hint: true, meta: true } })
  if (!row?.meta) return { connected: false as const }
  const meta = JSON.parse(row.meta) as { appId: string; tenantId: string | null }
  return { connected: true as const, appId: meta.appId, tenantId: meta.tenantId, hint: row.hint }
}

// --- outgoing --------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number; appId: string } | null = null

export async function botToken(credentials: TeamsCredentials): Promise<string> {
  if (TEST_CONNECTOR) return 'test-token'
  if (tokenCache && tokenCache.appId === credentials.appId && tokenCache.expiresAt > Date.now() + 5 * 60_000) return tokenCache.token
  const tenant = credentials.tenantId || 'botframework.com'
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.appId,
      client_secret: credentials.password,
      scope: 'https://api.botframework.com/.default',
    }),
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!response.ok || !body.access_token) {
    throw new Error(`Microsoft refused the bot’s credentials: ${body.error_description?.split('\r\n')[0] ?? response.status}`)
  }
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, appId: credentials.appId }
  return body.access_token
}

async function connector<T>(serviceUrl: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!isAllowedServiceUrl(serviceUrl)) throw new Error('Refusing to send the bot’s token to an unknown service URL.')
  const credentials = await teamsCredentials()
  if (!credentials) throw new Error('The Teams bot is not connected.')
  const response = await fetch(`${serviceUrl.replace(/\/+$/, '')}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await botToken(credentials)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Bot Connector ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

export interface OutgoingActivity {
  type: 'message' | 'typing'
  text?: string
  textFormat?: 'markdown' | 'plain'
  attachments?: unknown[]
}

export function sendActivity(serviceUrl: string, conversationId: string, activity: OutgoingActivity, replyToId?: string) {
  const base = `/v3/conversations/${encodeURIComponent(conversationId)}/activities`
  return connector<{ id?: string }>(serviceUrl, replyToId ? `${base}/${encodeURIComponent(replyToId)}` : base, {
    method: 'POST',
    body: { ...activity, ...(replyToId ? { replyToId } : {}) },
  })
}

/** The Teams account behind a message: email, UPN and Entra object id. */
export function getMember(serviceUrl: string, conversationId: string, memberId: string) {
  return connector<{ id: string; name?: string; email?: string; userPrincipalName?: string; aadObjectId?: string }>(
    serviceUrl,
    `/v3/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberId)}`,
  )
}

// --- incoming --------------------------------------------------------------------

interface BotKey extends JsonWebKey {
  kid?: string
  endorsements?: string[]
}

let keyCache: { keys: BotKey[]; fetchedAt: number } | null = null

async function signingKeys(force = false): Promise<BotKey[]> {
  if (TEST_JWKS) return (JSON.parse(TEST_JWKS) as { keys: BotKey[] }).keys
  // Microsoft asks for a refresh at least daily; twelve hours, and on any
  // unknown key id, which is how a rotation shows up.
  if (!force && keyCache && Date.now() - keyCache.fetchedAt < 12 * 3_600_000) return keyCache.keys
  const config = (await (await fetch(OPENID, { cache: 'no-store' })).json()) as { jwks_uri: string }
  const jwks = (await (await fetch(config.jwks_uri, { cache: 'no-store' })).json()) as { keys: BotKey[] }
  keyCache = { keys: jwks.keys, fetchedAt: Date.now() }
  return jwks.keys
}

function base64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Verifies a request from the Bot Connector. Returns the reason on failure;
 * the route answers 401 and does nothing else.
 */
export async function verifyIncoming(
  authorization: string | null,
  activity: { serviceUrl?: string; channelId?: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const credentials = await teamsCredentials()
  if (!credentials) return { ok: false, reason: 'bot not connected' }
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]
  if (!token) return { ok: false, reason: 'no bearer token' }
  const kid = headerOf(token)?.kid
  let keys = await signingKeys()
  // An unknown key id is how a rotation shows up: fetch once more.
  if (kid && !keys.some((entry) => entry.kid === kid)) keys = await signingKeys(true)
  return verifyBotJwt(token, keys, {
    appId: credentials.appId,
    serviceUrl: activity.serviceUrl ?? '',
    channelId: activity.channelId,
    nowSeconds: Math.floor(Date.now() / 1000),
  })
}

function headerOf(token: string): { alg?: string; kid?: string } | null {
  try {
    return JSON.parse(base64url(token.split('.')[0]).toString('utf8'))
  } catch {
    return null
  }
}

/**
 * The whole check, given the keys: RS256 only, a key Bot Framework published,
 * a valid signature, the key endorsed for the channel, and the claim rules.
 * Pure apart from the crypto, so the domain suite can sign test tokens.
 */
export function verifyBotJwt(
  token: string,
  keys: BotKey[],
  expected: { appId: string; serviceUrl: string; channelId?: string; nowSeconds: number },
): { ok: true } | { ok: false; reason: string } {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' }
  let claims: Record<string, unknown>
  const header = headerOf(token)
  try {
    claims = JSON.parse(base64url(parts[1]).toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed token' }
  }
  if (!header || header.alg !== 'RS256') return { ok: false, reason: 'unexpected signing algorithm' }

  const key = keys.find((entry) => entry.kid === header.kid)
  if (!key) return { ok: false, reason: 'unknown signing key' }

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${parts[0]}.${parts[1]}`)
  const { endorsements, ...rest } = key
  const jwk = { ...rest }
  delete jwk.kid
  let valid = false
  try {
    valid = verifier.verify(createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }), base64url(parts[2]))
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: 'bad signature' }
  // A key endorsed for particular channels may only sign for those.
  if (endorsements?.length && expected.channelId && !endorsements.includes(expected.channelId)) {
    return { ok: false, reason: 'key not endorsed for this channel' }
  }
  return checkBotClaims(claims, expected)
}

export type { BotKey }
