import { prisma } from '@/infrastructure/db/prisma'
import { listCodingEngines } from '@/infrastructure/ai'
import { expireStaleRuns } from './service'

/** What the ticket page's "Fix with AI" panel needs. */
export async function getAiFixPanel(ticketId: string, projectId: string) {
  await expireStaleRuns(ticketId)

  const [repos, runs] = await Promise.all([
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
  ])

  return {
    engines: listCodingEngines(),
    repos: repos.map((link) => ({ id: link.repo.id, fullName: link.repo.fullName, role: link.role })),
    runs,
  }
}

export type AiFixPanelData = Awaited<ReturnType<typeof getAiFixPanel>>
