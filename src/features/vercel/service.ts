import { prisma } from '@/infrastructure/db/prisma'
import { seal, unseal } from '@/infrastructure/github/secrets'
import { recordActivity } from '@/features/activity/service'
import { agentComment } from '@/features/agents/service'

/**
 * Vercel, for the one thing GitHub's record cannot do: put a previous
 * production deployment back.
 *
 * Deployments are *seen* through GitHub (see deployments.ts); only rollback
 * needs Vercel's API, and so only rollback needs a token. It uses Vercel's
 * Instant Rollback, which re-points production at an earlier build without
 * rebuilding — seconds, not minutes, which is the point during an incident.
 */

const KEY = 'vercel'
const API = 'https://api.vercel.com'

export async function saveVercelToken(token: string | null, teamId: string | null) {
  if (!token) {
    await prisma.integrationSecret.deleteMany({ where: { key: KEY } })
    return
  }
  const data = { valueEnc: seal(token), hint: token.slice(-4), meta: teamId || null }
  await prisma.integrationSecret.upsert({ where: { key: KEY }, create: { key: KEY, ...data }, update: data })
}

export async function vercelStatus() {
  const row = await prisma.integrationSecret.findUnique({ where: { key: KEY }, select: { hint: true, meta: true } })
  return row ? { connected: true, hint: row.hint, teamId: row.meta } : { connected: false, hint: null, teamId: null }
}

async function credentials() {
  const row = await prisma.integrationSecret.findUnique({ where: { key: KEY } })
  if (!row) throw new Error('Vercel is not connected. Add a token under Workspace → Integrations.')
  return { token: unseal(row.valueEnc), teamId: row.meta }
}

async function vercel<T>(path: string, init: { method?: string; teamId?: string | null } = {}): Promise<T> {
  const { token } = await credentials()
  const url = new URL(`${API}${path}`)
  if (init.teamId) url.searchParams.set('teamId', init.teamId)
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`Vercel ${response.status}: ${body.error?.message ?? response.statusText}`)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** Vercel's id for a deployment, found from the URL GitHub recorded for it. */
async function resolve(url: string, teamId: string | null) {
  const host = new URL(url).host
  return vercel<{ id: string; projectId: string; url: string }>(`/v13/deployments/${encodeURIComponent(host)}`, { teamId })
}

export async function verifyVercelToken() {
  const { teamId } = await credentials()
  const user = await vercel<{ user: { username: string } }>('/v2/user')
  return { username: user.user.username, teamId }
}

/**
 * Rolls a repository's production back to the successful production
 * deployment before `deploymentId`. Refuses when there is nothing earlier to
 * go back to, or when the deployment was not on Vercel.
 */
export async function rollbackTo(deploymentId: string, actorId: string) {
  const current = await prisma.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
    select: {
      id: true,
      repoId: true,
      url: true,
      environment: true,
      createdAt: true,
      isProduction: true,
      tickets: { select: { ticket: { select: { id: true, key: true, projectId: true } } } },
    },
  })
  if (!current.isProduction) throw new Error('Only a production deployment can be rolled back.')
  const previous = await prisma.deployment.findFirst({
    where: { repoId: current.repoId, isProduction: true, state: 'SUCCESS', createdAt: { lt: current.createdAt }, url: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { url: true, sha: true, createdAt: true },
  })
  if (!previous?.url) throw new Error('There is no earlier successful production deployment to roll back to.')
  if (!/vercel\.app|vercel\.com/.test(previous.url) && !/vercel/i.test(current.url ?? '')) {
    throw new Error('This deployment was not made by Vercel, so it cannot be rolled back from here.')
  }

  const { teamId } = await credentials()
  const target = await resolve(previous.url, teamId)
  await vercel(`/v9/projects/${target.projectId}/rollback/${target.id}`, { method: 'POST', teamId })

  for (const { ticket } of current.tickets) {
    await agentComment(
      'ops',
      ticket.id,
      `⏪ **Rolled back.** Production (${current.environment}) was put back to the deployment of ${previous.sha.slice(0, 7)} from ${previous.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC, which does not contain this change.`,
    )
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'INTEGRATION',
      entityId: ticket.id,
      entityLabel: ticket.key,
      projectId: ticket.projectId,
      ticketId: ticket.id,
      actorId,
      summary: `rolled production back to ${previous.sha.slice(0, 7)}, removing ${ticket.key} from ${current.environment}`,
    })
  }
  return { sha: previous.sha, url: previous.url }
}
