import { prisma } from '@/infrastructure/db/prisma'
import { listCodingEngines } from '@/features/ai-admin/engines'
import { expireStaleRuns } from './service'

/** What the ticket page's "Fix with AI" panel needs. */
export async function getAiFixPanel(ticketId: string, projectId: string) {
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
    repos: repos.map((link) => ({ id: link.repo.id, fullName: link.repo.fullName, role: link.role })),
    runs,
  }
}

export type AiFixPanelData = Awaited<ReturnType<typeof getAiFixPanel>>
