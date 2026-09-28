'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { listCodingEngines } from '@/features/ai-admin/engines'
import { assertWithinBudget } from '@/features/ai-admin/usage'
import { can, requireProjectPermission } from '@/features/auth/guards'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { executeFixRun } from './service'

const startSchema = z.object({
  ticketId: z.string().min(1),
  repoId: z.string().min(1),
  engine: z.enum(['anthropic', 'openai', 'groq']),
  instructions: z.string().trim().max(2000).optional(),
  /** PLAN posts a plan for approval; FIX writes the change. */
  mode: z.enum(['FIX', 'PLAN']).default('FIX'),
  /** Build the plan from this PLAN run. */
  planRunId: z.string().optional(),
  /** HEAL_CI: the pull request to fix. Set by healPullRequestAction. */
  targetPrNumber: z.number().int().positive().optional(),
})

/**
 * Starts a "Fix with AI" run and returns immediately.
 *
 * The work continues in `after()`, past the response, because a run takes
 * anywhere from twenty seconds to several minutes and nobody should hold a
 * request open for that. The ticket page polls the run row for progress.
 *
 * Three gates: `ai:code` (it costs money and writes to a repository), the
 * ordinary ability to edit this ticket, and the repository being linked to the
 * ticket's project — so nobody can point a model at a repository the project
 * was never given.
 */
export async function startAiFixAction(
  input: z.input<typeof startSchema>,
): Promise<ActionResult<{ runId: string }>> {
  return runAction(async () => {
    const data = startSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, key: true, projectId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')
    if (!can(actor, 'ai:code')) throw new ForbiddenError('Your role cannot start AI fixes (ai:code).')

    const link = await prisma.projectRepo.findUnique({
      where: { projectId_repoId: { projectId: ticket.projectId, repoId: data.repoId } },
      select: { repo: { select: { isAccessible: true } } },
    })
    if (!link) throw new BusinessRuleError('That repository is not linked to this project.')
    if (!link.repo.isAccessible) throw new BusinessRuleError('The GitHub App no longer has access to that repository.')

    const engine = (await listCodingEngines()).find((candidate) => candidate.id === data.engine)
    if (!engine) throw new BusinessRuleError(`The ${data.engine} engine is not configured on this server.`)

    await assertWithinBudget({ projectId: ticket.projectId, provider: engine.id })

    const active = await prisma.aiFixRun.count({
      where: { ticketId: ticket.id, status: { in: ['QUEUED', 'RUNNING'] } },
    })
    if (active > 0) throw new BusinessRuleError('A fix is already running for this ticket.')

    if (data.planRunId) {
      const plan = await prisma.aiFixRun.findFirst({
        where: { id: data.planRunId, ticketId: ticket.id, mode: 'PLAN', status: 'SUCCEEDED' },
        select: { id: true },
      })
      if (!plan) throw new BusinessRuleError('That plan is not available to build.')
    }

    const run = await prisma.aiFixRun.create({
      data: {
        ticketId: ticket.id,
        repoId: data.repoId,
        requestedById: actor.id,
        provider: engine.id,
        model: engine.model,
        instructions: data.instructions || null,
        mode: data.targetPrNumber ? 'HEAL_CI' : data.mode,
        planRunId: data.planRunId ?? null,
        targetPrNumber: data.targetPrNumber ?? null,
      },
      select: { id: true },
    })

    after(() => executeFixRun(run.id))

    revalidatePath(`/tickets/${ticket.key}`)
    return ok({ runId: run.id })
  })
}

/**
 * "Fix failing checks" on one of the ticket's open pull requests — any pull
 * request, not only one an AI opened, because a person's red build is just as
 * worth a first attempt.
 */
export async function healPullRequestAction(input: {
  ticketId: string
  refId: string
  engine: 'anthropic' | 'openai' | 'groq'
}): Promise<ActionResult<{ runId: string }>> {
  const ref = await prisma.ticketGitRef.findFirst({
    where: { id: input.refId, ticketId: input.ticketId, kind: 'PULL_REQUEST', state: { in: ['OPEN', 'DRAFT'] } },
    select: { repoId: true, externalId: true },
  })
  if (!ref) return { success: false, error: 'That pull request is not open on this ticket.' }
  return startAiFixAction({
    ticketId: input.ticketId,
    repoId: ref.repoId,
    engine: input.engine,
    mode: 'FIX',
    targetPrNumber: Number(ref.externalId),
  })
}
