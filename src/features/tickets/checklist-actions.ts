'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { NotFoundError } from '@/core/domain/errors'
import { normaliseCriterion } from '@/core/domain/ticket-templates'
import { calculatePosition } from '@/lib/utils'
import { runAction } from '@/lib/safe-action'
import { addChecklistItems, MAX_CRITERIA } from './service'

/**
 * Acceptance criteria: add, tick, reword, remove, reorder.
 *
 * Ticking is `ticket:update` in the ticket's project, like any other edit.
 * Each tick is on the ticket's history under the person who made it, because
 * "who said this was done" is exactly what a criterion is for.
 */

async function loadTicket(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, key: true, projectId: true },
  })
  if (!ticket) throw new NotFoundError('Ticket', ticketId)
  return ticket
}

async function loadItem(itemId: string) {
  const item = await prisma.ticketChecklistItem.findUnique({
    where: { id: itemId },
    select: { id: true, text: true, isDone: true, ticket: { select: { id: true, key: true, projectId: true } } },
  })
  if (!item) throw new NotFoundError('Criterion', itemId)
  return item
}

export async function addCriteriaAction(input: { ticketId: string; texts: string[] }): Promise<ActionResult<{ added: number }>> {
  return runAction(async () => {
    const data = z
      .object({ ticketId: z.string().min(1), texts: z.array(z.string().max(2000)).min(1).max(MAX_CRITERIA) })
      .parse(input)
    const ticket = await loadTicket(data.ticketId)
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')

    // A pasted block becomes one criterion per line, bullets and boxes removed.
    const texts = data.texts
      .flatMap((text) => text.split('\n'))
      .map((line) => line.replace(/^\s*(?:[-*+•]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/, ''))
      .map(normaliseCriterion)
      .filter(Boolean)
    if (texts.length === 0) return fail('Write the criterion first.')

    const added = await prisma.$transaction(async (tx) => {
      const count = await addChecklistItems(tx, { ticketId: ticket.id, texts, actorId: actor.id })
      if (count > 0) {
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId: ticket.projectId,
          ticketId: ticket.id,
          actorId: actor.id,
          field: 'criteria',
          newValue: texts.slice(0, count).join('; ').slice(0, 500),
          summary: `added ${count} acceptance ${count === 1 ? 'criterion' : 'criteria'} to ${ticket.key}`,
        })
      }
      return count
    })

    if (added === 0) return fail(`Those criteria are already on the ticket, or it has the maximum of ${MAX_CRITERIA}.`)
    revalidatePath(`/tickets/${ticket.key}`)
    return ok({ added })
  })
}

export async function toggleCriterionAction(input: { itemId: string; isDone: boolean }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ itemId: z.string().min(1), isDone: z.boolean() }).parse(input)
    const item = await loadItem(data.itemId)
    const { actor } = await requireProjectPermission(item.ticket.projectId, 'ticket:update')
    if (item.isDone === data.isDone) return ok()

    await prisma.$transaction(async (tx) => {
      await tx.ticketChecklistItem.update({
        where: { id: item.id },
        data: data.isDone ? { isDone: true, doneAt: new Date(), doneById: actor.id } : { isDone: false, doneAt: null, doneById: null },
      })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TICKET',
        entityId: item.ticket.id,
        entityLabel: item.ticket.key,
        projectId: item.ticket.projectId,
        ticketId: item.ticket.id,
        actorId: actor.id,
        field: 'criteria',
        oldValue: data.isDone ? 'open' : 'met',
        newValue: data.isDone ? 'met' : 'open',
        summary: `${data.isDone ? 'ticked' : 'unticked'} “${item.text.slice(0, 80)}” on ${item.ticket.key}`,
      })
    })

    revalidatePath(`/tickets/${item.ticket.key}`)
    return ok()
  })
}

export async function editCriterionAction(input: { itemId: string; text: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ itemId: z.string().min(1), text: z.string().max(2000) }).parse(input)
    const text = normaliseCriterion(data.text)
    if (!text) return fail('A criterion cannot be empty. Remove it instead.')
    const item = await loadItem(data.itemId)
    await requireProjectPermission(item.ticket.projectId, 'ticket:update')
    await prisma.ticketChecklistItem.update({ where: { id: item.id }, data: { text } })
    revalidatePath(`/tickets/${item.ticket.key}`)
    return ok()
  })
}

export async function removeCriterionAction(itemId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const item = await loadItem(z.string().min(1).parse(itemId))
    const { actor } = await requireProjectPermission(item.ticket.projectId, 'ticket:update')
    await prisma.$transaction(async (tx) => {
      await tx.ticketChecklistItem.delete({ where: { id: item.id } })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TICKET',
        entityId: item.ticket.id,
        entityLabel: item.ticket.key,
        projectId: item.ticket.projectId,
        ticketId: item.ticket.id,
        actorId: actor.id,
        field: 'criteria',
        oldValue: item.text.slice(0, 500),
        summary: `removed the criterion “${item.text.slice(0, 80)}” from ${item.ticket.key}`,
      })
    })
    revalidatePath(`/tickets/${item.ticket.key}`)
    return ok()
  })
}

export async function moveCriterionAction(input: {
  itemId: string
  beforePosition: number | null
  afterPosition: number | null
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z
      .object({ itemId: z.string().min(1), beforePosition: z.number().nullable(), afterPosition: z.number().nullable() })
      .parse(input)
    const item = await loadItem(data.itemId)
    await requireProjectPermission(item.ticket.projectId, 'ticket:update')
    await prisma.ticketChecklistItem.update({
      where: { id: item.id },
      data: { position: calculatePosition(data.beforePosition, data.afterPosition) },
    })
    revalidatePath(`/tickets/${item.ticket.key}`)
    return ok()
  })
}
