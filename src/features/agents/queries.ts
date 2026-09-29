import { prisma } from '@/infrastructure/db/prisma'
import { AGENTS, type AgentKind } from './service'

/**
 * The agent roster, and how the Coder's work has fared: of the pull requests
 * it opened, how many people merged, closed unmerged, or have not decided.
 * Acceptance is the honest measure of whether an agent is worth its cost, and
 * the one to watch before letting it merge anything on its own.
 */
export async function getAgentRoster() {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const users = await prisma.user.findMany({ where: { isAgent: true }, select: { id: true, username: true, name: true, avatarColor: true, jobTitle: true } })

  const roster = await Promise.all(
    (Object.keys(AGENTS) as AgentKind[]).map(async (kind) => {
      const user = users.find((entry) => entry.username === AGENTS[kind].username)
      const [actions, comments] = user
        ? await Promise.all([
            prisma.activityLog.count({ where: { actorId: user.id, createdAt: { gte: since } } }),
            prisma.comment.count({ where: { authorId: user.id, createdAt: { gte: since } } }),
          ])
        : [0, 0]
      return { kind, ...AGENTS[kind], active: Boolean(user), actions, comments }
    }),
  )

  const runs = await prisma.aiFixRun.findMany({
    where: { mode: 'FIX', status: 'SUCCEEDED', prNumber: { not: null } },
    select: { prNumber: true, repoId: true, ticketId: true, repo: { select: { fullName: true } } },
  })
  const refs = await prisma.ticketGitRef.findMany({
    where: { kind: 'PULL_REQUEST', OR: runs.map((run) => ({ repoId: run.repoId, externalId: String(run.prNumber), ticketId: run.ticketId })) },
    select: { repoId: true, externalId: true, state: true },
  })
  const stateOf = new Map(refs.map((ref) => [`${ref.repoId}#${ref.externalId}`, ref.state]))

  const byRepo = new Map<string, { repo: string; merged: number; closed: number; open: number }>()
  for (const run of runs) {
    const row = byRepo.get(run.repoId) ?? { repo: run.repo.fullName, merged: 0, closed: 0, open: 0 }
    const state = stateOf.get(`${run.repoId}#${run.prNumber}`)
    if (state === 'MERGED') row.merged++
    else if (state === 'CLOSED') row.closed++
    else row.open++
    byRepo.set(run.repoId, row)
  }

  return {
    roster,
    outcomes: [...byRepo.values()].map((row) => ({
      ...row,
      // Of the decided ones only: open pull requests say nothing yet.
      acceptance: row.merged + row.closed > 0 ? Math.round((row.merged / (row.merged + row.closed)) * 100) : null,
    })),
  }
}

export type AgentRoster = Awaited<ReturnType<typeof getAgentRoster>>
