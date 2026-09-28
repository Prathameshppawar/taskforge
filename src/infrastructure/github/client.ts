import { createHmac, createSign, timingSafeEqual } from 'node:crypto'

import { prisma } from '@/infrastructure/db/prisma'
import { unseal } from './secrets'

/**
 * A minimal GitHub App client.
 *
 * Deliberately not Octokit: the integration uses a dozen endpoints, and the two
 * pieces that are genuinely fiddly — signing the app JWT and verifying webhook
 * signatures — are a few lines each on `node:crypto`. Owning them keeps the
 * dependency tree unchanged and every request visible in one file.
 *
 * Two kinds of credential are in play:
 *   - the **app JWT**, signed with the app's private key, valid ten minutes,
 *     which may only talk about the app and its installations; and
 *   - an **installation token**, exchanged for with the JWT, valid one hour,
 *     which acts on the repositories that one installation was granted.
 * No person's token is ever involved, so nothing breaks when someone leaves.
 */

const API = 'https://api.github.com'

export interface AppCredentials {
  appId: number
  slug: string
  privateKey: string
  webhookSecret: string
  /** Where the credentials came from, for the integrations page. */
  source: 'env' | 'database'
}

export class GithubNotConfiguredError extends Error {
  constructor() {
    super('The GitHub App is not set up yet.')
  }
}

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`GitHub ${status} on ${path}: ${message}`)
  }
}

/**
 * The app's credentials: environment variables first, then the row the
 * manifest flow wrote. Env wins so a production deployment can pin its app
 * without depending on database state, and so a key can be rotated by
 * redeploying rather than by editing a row.
 */
export async function loadCredentials(): Promise<AppCredentials | null> {
  const env = process.env
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET) {
    return {
      appId: Number(env.GITHUB_APP_ID),
      slug: env.GITHUB_APP_SLUG ?? '',
      // Vercel and most dashboards store a multi-line PEM with literal \n.
      privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      source: 'env',
    }
  }

  const row = await prisma.githubApp.findUnique({ where: { id: 1 } })
  if (!row) return null

  return {
    appId: row.appId,
    slug: row.slug,
    privateKey: unseal(row.privateKeyEnc),
    webhookSecret: unseal(row.webhookSecretEnc),
    source: 'database',
  }
}

async function requireCredentials(): Promise<AppCredentials> {
  const credentials = await loadCredentials()
  if (!credentials) throw new GithubNotConfiguredError()
  return credentials
}

// -----------------------------------------------------------------------------
// App JWT
// -----------------------------------------------------------------------------

/**
 * An RS256 JWT identifying the app.
 *
 * Backdated a minute because GitHub rejects an `iat` in its future, and clocks
 * drift; nine minutes of life rather than the ten allowed for the same reason.
 */
export function createAppJwt(appId: number, privateKey: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: seconds - 60, exp: seconds + 9 * 60, iss: String(appId) }

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode(header)}.${encode(payload)}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')
  return `${unsigned}.${signature}`
}

// -----------------------------------------------------------------------------
// Installation tokens
// -----------------------------------------------------------------------------

/**
 * Installation tokens, cached per process until five minutes before expiry.
 *
 * On serverless this cache lives only as long as a warm function, which is
 * fine: the exchange is one request, and the point is to not repeat it for
 * every call inside a single webhook or sweep.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function installationToken(installationId: bigint | number | string): Promise<string> {
  const id = String(installationId)
  const cached = tokenCache.get(id)
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token

  const credentials = await requireCredentials()
  const result = await request<{ token: string; expires_at: string }>(
    `/app/installations/${id}/access_tokens`,
    { method: 'POST', auth: `Bearer ${createAppJwt(credentials.appId, credentials.privateKey)}` },
  )

  tokenCache.set(id, { token: result.token, expiresAt: Date.parse(result.expires_at) })
  return result.token
}

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** A full Authorization header value. Omitted for the unauthenticated calls. */
  auth?: string
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TaskForge',
      ...(options.auth ? { Authorization: options.auth } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = text
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text
    } catch {
      // Not JSON; keep the raw text.
    }
    throw new GithubApiError(response.status, path, message.slice(0, 300))
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** A call made as the app itself — about the app and its installations. */
export async function asApp<T>(path: string, options: Omit<RequestOptions, 'auth'> = {}): Promise<T> {
  const credentials = await requireCredentials()
  return request<T>(path, {
    ...options,
    auth: `Bearer ${createAppJwt(credentials.appId, credentials.privateKey)}`,
  })
}

/** A call made as one installation — on the repositories it was granted. */
export async function asInstallation<T>(
  installationId: bigint | number | string,
  path: string,
  options: Omit<RequestOptions, 'auth'> = {},
): Promise<T> {
  const token = await installationToken(installationId)
  return request<T>(path, { ...options, auth: `token ${token}` })
}

/**
 * The manifest exchange. Unauthenticated by design: the one-time `code` GitHub
 * put in the redirect *is* the credential, and it expires within the hour.
 */
export async function convertManifest<T>(code: string): Promise<T> {
  return request<T>(`/app-manifests/${encodeURIComponent(code)}/conversions`, { method: 'POST' })
}

// -----------------------------------------------------------------------------
// Webhook signatures
// -----------------------------------------------------------------------------

/**
 * Verifies `X-Hub-Signature-256` against the raw request body.
 *
 * Must be the raw bytes: re-serialising parsed JSON changes whitespace and key
 * order, and the HMAC then never matches. Constant-time comparison, so the
 * secret cannot be recovered a byte at a time from response timings.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false

  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`,
    'utf8',
  )
  const actual = Buffer.from(signatureHeader, 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
