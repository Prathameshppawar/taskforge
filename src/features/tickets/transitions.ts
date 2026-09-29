import type { Prisma } from '@prisma/client'

import { BusinessRuleError } from '@/core/domain/errors'
import { describeUnmet, unmetRequirements, type TransitionFacts } from '@/core/domain/transitions'

type Tx = Prisma.TransactionClient

/** What the rules read about a ticket, in one round trip per relation. */
export async function transitionFacts(tx: Tx, ticketId: string): Promise<TransitionFacts> {
  const ticket = await tx.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: {
      assigneeId: true,
      storyPoints: true,
      estimateHours: true,
      projectId: true,
      checklist: { select: { isDone: true } },
      gitRefs: { where: { kind: 'PULL_REQUEST' }, select: { state: true } },
      fieldValues: { select: { fieldId: true } },
    },
  })
  const fields = await tx.customField.findMany({ where: { projectId: ticket.projectId }, select: { id: true, name: true } })
  return {
    assigneeId: ticket.assigneeId,
    storyPoints: ticket.storyPoints,
    estimateHours: ticket.estimateHours === null ? null : Number(ticket.estimateHours),
    criteria: { total: ticket.checklist.length, met: ticket.checklist.filter((item) => item.isDone).length },
    pullRequests: {
      open: ticket.gitRefs.filter((ref) => ref.state === 'OPEN' || ref.state === 'DRAFT').length,
      merged: ticket.gitRefs.filter((ref) => ref.state === 'MERGED').length,
    },
    filledFields: new Set(ticket.fieldValues.map((value) => value.fieldId)),
    fieldNames: new Map(fields.map((field) => [field.id, field.name])),
  }
}

/**
 * Refuses a move a person makes into a status whose requirements the ticket
 * does not meet, saying what is missing. Called by every path a person moves
 * a ticket through; automation does not call it.
 */
export async function assertCanEnter(
  tx: Tx,
  ticketId: string,
  status: { name: string; requirements: string[] },
): Promise<void> {
  if (status.requirements.length === 0) return
  const unmet = unmetRequirements(status.requirements, await transitionFacts(tx, ticketId))
  if (unmet.length > 0) throw new BusinessRuleError(describeUnmet(status.name, unmet))
}
