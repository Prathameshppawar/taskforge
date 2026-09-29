import { prisma } from '@/infrastructure/db/prisma'
import { seal, unseal } from '@/infrastructure/github/secrets'

/**
 * A person's own GitHub authorisation, through the TaskForge app.
 *
 * The app acts on repositories it was granted; it cannot create a repository
 * under a personal account, because only that account can. So creating one
 * uses a user access token: the OAuth web flow of the same GitHub App, whose
 * token acts as the person and is limited to what the app may do. GitHub
 * issues these to expire (eight hours), with a refresh token (six months).
 */

async function clientCredentials() {
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    return { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }
  }
  const app = await prisma.githubApp.findUnique({ where: { id: 1 }, select: { clientId: true, clientSecretEnc: true } })
  if (!app) throw new Error('Create the GitHub App first (Workspace → Integrations).')
  return { clientId: app.clientId, clientSecret: unseal(app.clientSecretEnc) }
}

export function callbackUrl(origin: string) {
  return `${origin}/api/github/user/callback`
}

export async function authorizeUrl(origin: string, state: string) {
  const { clientId } = await clientCredentials()
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', callbackUrl(origin))
  url.searchParams.set('state', state)
  return url.toString()
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    cache: 'no-store',
  })
  return (await response.json()) as TokenResponse
}

async function store(userId: string, token: TokenResponse, login?: string) {
  if (!token.access_token) throw new Error(token.error_description ?? token.error ?? 'GitHub did not issue a token.')
  const githubLogin =
    login ??
    ((await (
      await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TaskForge' },
      })
    ).json()) as { login: string }).login
  const now = Date.now()
  const data = {
    githubLogin,
    tokenEnc: seal(token.access_token),
    refreshEnc: token.refresh_token ? seal(token.refresh_token) : null,
    expiresAt: token.expires_in ? new Date(now + token.expires_in * 1000) : null,
    refreshExpiresAt: token.refresh_token_expires_in ? new Date(now + token.refresh_token_expires_in * 1000) : null,
  }
  await prisma.githubUserToken.upsert({ where: { userId }, create: { userId, ...data }, update: data })
  return githubLogin
}

export async function exchangeCode(userId: string, code: string, origin: string) {
  const { clientId, clientSecret } = await clientCredentials()
  return store(userId, await tokenRequest({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl(origin) }))
}

/** The person's GitHub token, refreshed first when it is about to expire; null if not connected. */
export async function userAccessToken(userId: string): Promise<{ token: string; login: string } | null> {
  const row = await prisma.githubUserToken.findUnique({ where: { userId } })
  if (!row) return null
  const fresh = !row.expiresAt || row.expiresAt.getTime() - Date.now() > 5 * 60_000
  if (fresh) return { token: unseal(row.tokenEnc), login: row.githubLogin }
  if (!row.refreshEnc || (row.refreshExpiresAt && row.refreshExpiresAt < new Date())) return null

  const { clientId, clientSecret } = await clientCredentials()
  const refreshed = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: unseal(row.refreshEnc),
  })
  if (!refreshed.access_token) return null
  await store(userId, refreshed, row.githubLogin)
  return { token: refreshed.access_token, login: row.githubLogin }
}

export async function githubConnection(userId: string) {
  const row = await prisma.githubUserToken.findUnique({ where: { userId }, select: { githubLogin: true, refreshExpiresAt: true } })
  return row ? { login: row.githubLogin, expiresAt: row.refreshExpiresAt } : null
}

export async function disconnectGithub(userId: string) {
  await prisma.githubUserToken.deleteMany({ where: { userId } })
}
