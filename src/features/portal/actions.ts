'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectPermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { assertCanEnter } from '@/features/tickets/transitions'

/**
 * Sign work off: Review → Done, and only that. A client may approve what is
 * waiting on them without being able to move tickets anywhere else, which is
 * why this is its own permission and not `ticket:transition`.
 */
export async function approveTicketAction(ticketKey: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ticket = await prisma.ticket.findUnique({
      where: { key: ticketKey },
      select: { id: true, key: true, projectId: true, completedAt: true, status: { select: { name: true, category: true } } },
    })
    if (!ticket) throw new NotFoundError('Ticket', ticketKey)
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:approve')
    if (ticket.status.category !== 'REVIEW') throw new BusinessRuleError('Only work waiting for review can be approved.')

    const done = await prisma.status.findFirst({
      where: { projectId: ticket.projectId, category: 'DONE' },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, requirements: true },
    })
    if (!done) throw new BusinessRuleError('This project has no Done status.')

    await prisma.$transaction(async (tx) => {
      // Approval is a person's move like any other, so Done's rules apply.
      await assertCanEnter(tx, ticket.id, done)
      await tx.ticket.update({ where: { id: ticket.id }, data: { statusId: done.id, completedAt: ticket.completedAt ?? new Date() } })
      await recordActivity(tx, {
        action: 'STATUS_CHANGED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        field: 'status',
        oldValue: ticket.status.name,
        newValue: done.name,
        summary: `approved ${ticket.key}`,
      })
    })
    revalidatePath('/portal')
    revalidatePath(`/tickets/${ticket.key}`)
    return ok()
  })
}
