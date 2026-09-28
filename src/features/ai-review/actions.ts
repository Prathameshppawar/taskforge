'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { AiProviderError } from '@/infrastructure/ai'
import { can, requireProjectPermission } from '@/features/auth/guards'
import { listCodingEngines } from '@/features/ai-admin/engines'
import { assertWithinBudget } from '@/features/ai-admin/usage'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { reviewPullRequest } from './service'

const schema = z.object({
  ticketId: z.string().min(1),
  refId: z.string().min(1),
  engine: z.enum(['anthropic', 'openai', 'groq']),
})

/** Same three gates as Fix with AI: edit the ticket, hold ai:code, within budget. */
export async function reviewPullRequestAction(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ verdict: string; inline: number; general: number; url: string }>> {
  return runAction(async () => {
    const data = schema.parse(input)
    const ticket = await prisma.ticket.findUnique({ where: { id: data.ticketId }, select: { key: true, projectId: true } })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')
    if (!can(actor, 'ai:code')) throw new ForbiddenError('Your role cannot use AI on code (ai:code).')

    const engine = (await listCodingEngines()).find((candidate) => candidate.id === data.engine)
    if (!engine) throw new BusinessRuleError(`The ${data.engine} engine is not configured.`)
    await assertWithinBudget({ projectId: ticket.projectId, provider: engine.id })

    try {
      const result = await reviewPullRequest({
        ticketId: data.ticketId,
        refId: data.refId,
        engine: engine.id,
        engineModel: engine.model,
        requestedById: actor.id,
      })
      revalidatePath(`/tickets/${ticket.key}`)
      return ok(result)
    } catch (error) {
      if (error instanceof AiProviderError) throw new BusinessRuleError(error.message)
      throw error
    }
  })
}
