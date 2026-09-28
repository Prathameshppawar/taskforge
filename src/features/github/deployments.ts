import type { DeploymentState } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { asInstallation } from '@/infrastructure/github/client'
import { recordActivity } from '@/features/activity/service'
import { mayAdvance } from '@/core/domain/git-refs'
import { isTerminal } from '@/core/domain/ticket-rules'

/**
 * Deployments: what shipped, where, and whether it worked.
 *
 * Read from GitHub's Deployments API rather than any one host's, because
 * Vercel, Netlify, Render and plain workflows all report there. A preview
 * deployment attaches its link to the tickets on that branch; a successful
 * production deployment marks every ticket it shipped as live and — if the
 * project automates — moves a merged ticket to Done.
 */

export interface GhDeployment {
  id: number
  sha: string
  ref: string
  environment: string
  original_environment?: string
  production_environment?: boolean
  transient_environment?: boolean
  description?: string | null
  creator?: { login: string } | null
  created_at: string
}

export interface GhDeploymentStatus {
  state: string
  target_url?: string | null
  environment_url?: string | null
  log_url?: string | null
  description?: string | null
}

type RepoRow = { id: string; fullName: string; defaultBranch: string; installation: { installationId: bigint } }

function toState(state: string): DeploymentState {
  switch (state) {
    case 'success':
      return 'SUCCESS'
    case 'failure':
      return 'FAILURE'
    case 'error':
      return 'ERROR'
    case 'inactive':
      return 'INACTIVE'
    case 'in_progress':
      return 'IN_PROGRESS'
    case 'queued':
      return 'QUEUED'
    default:
      return 'PENDING'
  }
}

/**
 * Production if the provider says so; otherwise by name, because not every
 * provider sets `production_environment` and "Production" is the convention.
 */
export function isProductionEnvironment(deployment: Pick<GhDeployment, 'environment' | 'production_environment' | 'original_environment'>): boolean {
  if (typeof deployment.production_environment === 'boolean') return deployment.production_environment
  return /^prod(uction)?$/i.test(deployment.original_environment ?? deployment.environment)
}

/** Records one deployment and its latest status, then attaches and automates. */
export async function recordDeployment(repo: RepoRow, deployment: GhDeployment, status: GhDeploymentStatus | null) {
  const state = status ? toState(status.state) : 'PENDING'
  const isProduction = isProductionEnvironment(deployment)
  const data = {
    repoId: repo.id,
    environment: deployment.environment,
    isProduction,
    state,
    url: status?.environment_url || status?.target_url || null,
    logUrl: status?.log_url || null,
    sha: deployment.sha,
    ref: deployment.ref,
    creatorLogin: deployment.creator?.login ?? null,
    description: status?.description ?? deployment.description ?? null,
  }

  const existing = await prisma.deployment.findUnique({
    where: { githubId: BigInt(deployment.id) },
    select: { id: true, state: true },
  })
  const row = await prisma.deployment.upsert({
    where: { githubId: BigInt(deployment.id) },
    create: { githubId: BigInt(deployment.id), createdAt: new Date(deployment.created_at), ...data },
    update: data,
  })

  const tickets = await ticketsShippedBy(repo, row)
  if (tickets.length > 0) {
    await prisma.ticketDeployment.createMany({
      data: tickets.map((ticket) => ({ ticketId: ticket.id, deploymentId: row.id })),
      skipDuplicates: true,
    })
  }

  // Only a transition into SUCCESS announces anything; a redelivered status or
  // a sweep that sees it again stays quiet.
  const becameLive = state === 'SUCCESS' && existing?.state !== 'SUCCESS'
  if (!becameLive) return { deploymentId: row.id, tickets: tickets.map((ticket) => ticket.key) }

  for (const ticket of tickets) {
    await prisma.$transaction(async (tx) => {
      const where = `${deployment.environment}${data.url ? ` (${data.url})` : ''}`
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'INTEGRATION',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        summary: isProduction ? `shipped ${ticket.key} to ${where}` : `deployed a preview of ${ticket.key} to ${where}`,
      })

      if (!isProduction || !ticket.merged || ticket.automation === false) return
      if (!mayAdvance(ticket.statusCategory, 'DONE')) return
      const done = await tx.status.findFirst({
        where: { projectId: ticket.projectId, category: 'DONE' },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, category: true },
      })
      if (!done) return
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { statusId: done.id, completedAt: isTerminal(done.category) ? new Date() : null },
      })
      await recordActivity(tx, {
        action: 'STATUS_CHANGED',
        entityType: 'INTEGRATION',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        field: 'status',
        oldValue: ticket.statusName,
        newValue: done.name,
        summary: `moved ${ticket.key} to ${done.name} — it is live in ${deployment.environment}`,
      })
    })
  }

  return { deploymentId: row.id, tickets: tickets.map((ticket) => ticket.key) }
}

/**
 * The tickets a deployment contains.
 *
 * A preview is one branch, so it is the tickets on that branch's pull request
 * or with that head commit. Production is everything since the last successful
 * production deployment of this repository: GitHub's compare API lists those
 * commits, and each is matched against merge commits and recorded commits.
 * Without a previous one there is nothing to compare against, so only the
 * deployed commit itself is matched — never "everything ever merged".
 */
async function ticketsShippedBy(repo: RepoRow, deployment: { id: string; sha: string; ref: string; isProduction: boolean }) {
  let shas = [deployment.sha]

  if (deployment.isProduction) {
    const previous = await prisma.deployment.findFirst({
      where: {
        repoId: repo.id,
        isProduction: true,
        state: 'SUCCESS',
        id: { not: deployment.id },
        sha: { not: deployment.sha },
      },
      orderBy: { createdAt: 'desc' },
      select: { sha: true },
    })
    if (previous) {
      const compare = await asInstallation<{ commits: Array<{ sha: string }> }>(
        repo.installation.installationId,
        `/repos/${repo.fullName}/compare/${previous.sha}...${deployment.sha}`,
      ).catch(() => null)
      if (compare) shas = [...new Set([...compare.commits.map((commit) => commit.sha), deployment.sha])]
    }
  }

  const refs = await prisma.ticketGitRef.findMany({
    where: {
      repoId: repo.id,
      OR: [
        { mergeCommitSha: { in: shas } },
        { headSha: { in: shas } },
        { kind: 'COMMIT', externalId: { in: shas } },
        // A preview built from a branch belongs to the tickets on that branch.
        ...(deployment.isProduction ? [] : [{ kind: 'BRANCH' as const, externalId: deployment.ref }, { headBranch: deployment.ref }]),
      ],
    },
    select: {
      ticket: {
        select: {
          id: true,
          key: true,
          projectId: true,
          status: { select: { name: true, category: true } },
          project: { select: { settings: { select: { githubAutomation: true } } } },
          gitRefs: { where: { kind: 'PULL_REQUEST', state: 'MERGED' }, select: { id: true }, take: 1 },
        },
      },
    },
  })

  const byId = new Map<string, {
    id: string
    key: string
    projectId: string
    statusName: string
    statusCategory: Parameters<typeof mayAdvance>[0]
    merged: boolean
    automation: boolean | undefined
  }>()
  for (const { ticket } of refs) {
    byId.set(ticket.id, {
      id: ticket.id,
      key: ticket.key,
      projectId: ticket.projectId,
      statusName: ticket.status.name,
      statusCategory: ticket.status.category,
      merged: ticket.gitRefs.length > 0,
      automation: ticket.project.settings?.githubAutomation,
    })
  }
  return [...byId.values()]
}

/** Recent deployments of one repository, for reconciliation. */
export async function reconcileDeployments(repo: RepoRow) {
  const deployments = await asInstallation<GhDeployment[]>(
    repo.installation.installationId,
    `/repos/${repo.fullName}/deployments?per_page=20`,
  ).catch(() => [] as GhDeployment[])

  const touched = new Set<string>()
  // Oldest first, so each production deployment finds the one before it.
  for (const deployment of [...deployments].reverse()) {
    const statuses = await asInstallation<GhDeploymentStatus[]>(
      repo.installation.installationId,
      `/repos/${repo.fullName}/deployments/${deployment.id}/statuses?per_page=1`,
    ).catch(() => [] as GhDeploymentStatus[])
    const result = await recordDeployment(repo, deployment, statuses[0] ?? null)
    result.tickets.forEach((key) => touched.add(key))
  }
  return [...touched]
}

/** Deployments for a ticket's Development panel, newest first, one per environment. */
export async function ticketDeployments(ticketId: string) {
  const rows = await prisma.ticketDeployment.findMany({
    where: { ticketId },
    orderBy: { deployment: { createdAt: 'desc' } },
    take: 20,
    select: {
      deployment: {
        select: {
          id: true,
          environment: true,
          isProduction: true,
          state: true,
          url: true,
          logUrl: true,
          sha: true,
          createdAt: true,
          repo: { select: { fullName: true } },
        },
      },
    },
  })
  const latest = new Map<string, (typeof rows)[number]['deployment']>()
  for (const { deployment } of rows) {
    const key = `${deployment.repo.fullName}:${deployment.environment}`
    if (!latest.has(key)) latest.set(key, deployment)
  }
  return [...latest.values()]
}
