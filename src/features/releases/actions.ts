'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { AiProviderError } from '@/infrastructure/ai'
import { can, requireProjectPermission } from '@/features/auth/guards'
import { agentEngine } from '@/features/ai-admin/engines'
import { assertWithinBudget } from '@/features/ai-admin/usage'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError, ForbiddenError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { draftReleaseNotes } from './service'

const schema = z.object({ ticketId: z.string().min(1), publish: z.boolean() })

/**
 * Draft (and optionally publish) release notes. Drafting needs ticket edit
 * rights and `ai:use`; publishing a GitHub release is a release decision, so
 * it needs project configuration rights on top.
 */
export async function draftReleaseNotesAction(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ count: number; release: { html_url: string; tag: string } | null }>> {
  return runAction(async () => {
    const data = schema.parse(input)
    const ticket = await prisma.ticket.findUnique({ where: { id: data.ticketId }, select: { key: true, projectId: true } })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, data.publish ? 'project:manage-config' : 'ticket:update')
    if (!can(actor, 'ai:use')) throw new ForbiddenError('Your role cannot use the AI features.')
    const engine = await agentEngine('release')
    if (!engine) throw new BusinessRuleError('No AI engine is configured.')
    await assertWithinBudget({ projectId: ticket.projectId, provider: engine.id })

    try {
      const result = await draftReleaseNotes({
        ticketId: data.ticketId,
        engine: engine.id,
        engineModel: engine.model,
        requestedById: actor.id,
        publish: data.publish,
      })
      revalidatePath(`/tickets/${ticket.key}`)
      return ok(result)
    } catch (error) {
      if (error instanceof AiProviderError) throw new BusinessRuleError(error.message)
      if (error instanceof Error && !(error instanceof BusinessRuleError)) throw new BusinessRuleError(error.message)
      throw error
    }
  })
}
