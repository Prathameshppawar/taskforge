import { prisma } from '@/infrastructure/db/prisma'
import { agentEngine, listCodingEngines } from '@/features/ai-admin/engines'
import { expireStaleRuns } from './service'
import { githubConnection } from '@/features/github/user-auth'

/** What the ticket page's "Fix with AI" panel needs. */
export async function getAiFixPanel(ticketId: string, projectId: string, actorId: string) {
  await expireStaleRuns(ticketId)

  const [repos, runs, engines, failing, openPrs] = await Promise.all([
    prisma.projectRepo.findMany({
      where: { projectId, repo: { isAccessible: true } },
      orderBy: { createdAt: 'asc' },
      select: { role: true, repo: { select: { id: true, fullName: true } } },
    }),
    prisma.aiFixRun.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        mode: true,
        targetPrNumber: true,
        provider: true,
        model: true,
        status: true,
        prNumber: true,
        prUrl: true,
        summary: true,
        error: true,
        changedFiles: true,
        transcript: true,
        turns: true,
        inputTokens: true,
        outputTokens: true,
        createdAt: true,
        finishedAt: true,
        requestedBy: { select: { name: true } },
        repo: { select: { fullName: true } },
      },
    }),
    listCodingEngines(),
    // Open pull requests with red checks: each can be handed to the Coder.
    prisma.ticketGitRef.findMany({
      where: { ticketId, kind: 'PULL_REQUEST', state: { in: ['OPEN', 'DRAFT'] }, checkState: 'FAILURE' },
      select: { id: true, externalId: true, title: true, repo: { select: { fullName: true } } },
    }),
    prisma.ticketGitRef.findMany({
      where: { ticketId, kind: 'PULL_REQUEST', state: { in: ['OPEN', 'DRAFT'] } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, externalId: true, title: true },
    }),
  ])

  return {
    engines,
    failing,
    openPrs,
    // For "Start a new repository": the person's own GitHub, and the accounts
    // the app is installed on, which are where a new repository can go.
    github: await githubConnection(actorId),
    // Which engine each agent uses, so the panel starts on the right one.
    agents: {
      coder: await agentEngine('coder'),
      planner: await agentEngine('planner'),
      reviewer: await agentEngine('reviewer'),
    },
    owners: (
      await prisma.githubInstallation.findMany({ where: { removedAt: null, suspendedAt: null }, select: { accountLogin: true, accountType: true } })
    ).map((entry) => ({ login: entry.accountLogin, type: entry.accountType })),
    repos: repos.map((link) => ({ id: link.repo.id, fullName: link.repo.fullName, role: link.role })),
    runs,
  }
}

export type AiFixPanelData = Awaited<ReturnType<typeof getAiFixPanel>>
