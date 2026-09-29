'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { AiProviderError } from '@/infrastructure/ai'
import { requireProjectPermission } from '@/features/auth/guards'
import { agentEngine } from '@/features/ai-admin/engines'
import { assertWithinBudget } from '@/features/ai-admin/usage'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { draftPostmortem } from './service'

export async function draftPostmortemAction(ticketId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { key: true, projectId: true } })
    if (!ticket) throw new NotFoundError('Ticket', ticketId)
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')
    const engine = await agentEngine('ops')
    if (!engine) throw new BusinessRuleError('No AI engine is configured.')
    await assertWithinBudget({ projectId: ticket.projectId, provider: engine.id })
    try {
      await draftPostmortem({ ticketId, engine: engine.id, engineModel: engine.model, requestedById: actor.id })
    } catch (error) {
      if (error instanceof AiProviderError || error instanceof Error) throw new BusinessRuleError(error.message)
      throw error
    }
    revalidatePath(`/tickets/${ticket.key}`)
    return ok()
  })
}
