import { after } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { agentEngine } from '@/features/ai-admin/engines'
import { assertWithinBudget } from '@/features/ai-admin/usage'
import { executeFixRun } from './service'

/** Attempts per pull request, so a failure the model cannot fix does not loop forever. */
export const MAX_HEAL_ATTEMPTS = 2

/**
 * Called when a check suite fails. For each pull request an AI run opened, in
 * a project that allows it, starts a HEAL_CI run — unless one is running, the
 * attempts are used up, the engine is gone, or a hard budget is spent. Each of
 * those is a reason to stop quietly rather than an error: this runs from a
 * webhook, and nobody is waiting on it.
 */
export async function maybeAutoHeal(repoId: string, prNumbers: number[]) {
  for (const prNumber of prNumbers) {
    const origin = await prisma.aiFixRun.findFirst({
      where: { repoId, prNumber, status: 'SUCCEEDED', mode: 'FIX' },
      orderBy: { createdAt: 'desc' },
      select: {
        ticketId: true,
        provider: true,
        ticket: { select: { projectId: true, project: { select: { settings: { select: { aiAutoHeal: true } } } } } },
      },
    })
    if (!origin?.ticket.project.settings?.aiAutoHeal) continue

    const previous = await prisma.aiFixRun.findMany({
      where: { repoId, targetPrNumber: prNumber, mode: 'HEAL_CI' },
      select: { status: true },
    })
    if (previous.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING')) continue
    if (previous.length >= MAX_HEAL_ATTEMPTS) continue

    // Healing is the Coder's job, on the Coder's engine.
    const engine = await agentEngine('coder')
    if (!engine) continue
    try {
      await assertWithinBudget({ projectId: origin.ticket.projectId, provider: engine.id })
    } catch {
      continue
    }

    const run = await prisma.aiFixRun.create({
      data: {
        ticketId: origin.ticketId,
        repoId,
        provider: engine.id,
        model: engine.model,
        mode: 'HEAL_CI',
        targetPrNumber: prNumber,
        instructions: `Automatic attempt ${previous.length + 1} of ${MAX_HEAL_ATTEMPTS}.`,
      },
      select: { id: true },
    })
    after(() => executeFixRun(run.id))
  }
}
