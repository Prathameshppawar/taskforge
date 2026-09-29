'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireActor, requireProjectPermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { formatMinutes, parseDuration, timerMinutes } from '@/core/domain/time'
import { runAction } from '@/lib/safe-action'

/**
 * Time on tickets: one running timer per person, and entries typed in.
 *
 * Logging time is work on the ticket, so it takes `ticket:update` in its
 * project — clients, who can comment, do not log hours. An entry belongs to
 * whoever logged it: only they edit it, and a project manager may remove it.
 */

async function ticketFor(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, key: true, projectId: true } })
  if (!ticket) throw new NotFoundError('Ticket', ticketId)
  return ticket
}

function revalidateTime(ticketKey?: string) {
  if (ticketKey) revalidatePath(`/tickets/${ticketKey}`)
  revalidatePath('/time')
  revalidatePath('/', 'layout')
}

/** Stops the actor's running timer, if any, inside the caller's transaction. */
async function stopRunning(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const running = await tx.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { id: true, startedAt: true, ticket: { select: { key: true } } },
  })
  if (!running) return null
  const minutes = timerMinutes(running.startedAt, now)
  await tx.timeEntry.update({ where: { id: running.id }, data: { endedAt: now, minutes } })
  return { ...running, minutes }
}

export async function startTimerAction(ticketId: string): Promise<ActionResult<{ stopped: string | null }>> {
  return runAction(async () => {
    const ticket = await ticketFor(z.string().min(1).parse(ticketId))
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')
    const now = new Date()

    try {
      const stopped = await prisma.$transaction(async (tx) => {
        const previous = await stopRunning(tx, actor.id, now)
        await tx.timeEntry.create({
          data: { ticketId: ticket.id, userId: actor.id, startedAt: now, source: 'TIMER' },
        })
        return previous
      })
      revalidateTime(ticket.key)
      if (stopped) revalidatePath(`/tickets/${stopped.ticket.key}`)
      return ok({ stopped: stopped ? `${formatMinutes(stopped.minutes)} on ${stopped.ticket.key}` : null })
    } catch (error) {
      // The one-running-timer index: another tab started one a moment ago.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return fail('A timer is already running in another tab. Refresh to see it.')
      }
      throw error
    }
  })
}

export async function stopTimerAction(): Promise<ActionResult<{ minutes: number; ticketKey: string } | null>> {
  return runAction(async () => {
    const actor = await requireActor()
    const stopped = await prisma.$transaction((tx) => stopRunning(tx, actor.id, new Date()))
    revalidateTime(stopped?.ticket.key)
    return ok(stopped ? { minutes: stopped.minutes, ticketKey: stopped.ticket.key } : null)
  })
}

const logInput = z.object({
  ticketId: z.string().min(1),
  duration: z.string().trim().min(1).max(40),
  /** The day the work was done; today when omitted. */
  date: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
  billable: z.boolean().default(true),
})

export async function logTimeAction(input: z.input<typeof logInput>): Promise<ActionResult<{ minutes: number }>> {
  return runAction(async () => {
    const data = logInput.parse(input)
    const minutes = parseDuration(data.duration)
    if (!minutes) {
      return fail('Write a duration like 45m, 1h 30m, 1.5h or 1:30 — up to 24 hours.', {
        fieldErrors: { duration: ['Not a duration.'] },
      })
    }
    const ticket = await ticketFor(data.ticketId)
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')

    // An entry for a past day is placed at noon, so no time zone moves it to
    // the day before or after.
    const day = data.date ?? new Date()
    const startedAt = data.date ? new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12)) : new Date(day.getTime() - minutes * 60_000)
    if (startedAt.getTime() > Date.now() + 86_400_000) return fail('Time cannot be logged for a future day.')

    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.create({
        data: {
          ticketId: ticket.id,
          userId: actor.id,
          startedAt,
          endedAt: new Date(startedAt.getTime() + minutes * 60_000),
          minutes,
          note: data.note || null,
          billable: data.billable,
          source: 'MANUAL',
        },
      })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        field: 'time',
        newValue: String(minutes),
        summary: `logged ${formatMinutes(minutes)} on ${ticket.key}${data.billable ? '' : ' (not billable)'}`,
      })
    })

    revalidateTime(ticket.key)
    return ok({ minutes })
  })
}

async function ownEntry(entryId: string, allowManager: boolean) {
  const actor = await requireActor()
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true, minutes: true, endedAt: true, ticket: { select: { id: true, key: true, projectId: true } } },
  })
  if (!entry) throw new NotFoundError('Time entry', entryId)
  if (entry.userId !== actor.id) {
    if (!allowManager) throw new ForbiddenError('You can only change your own time.')
    await requireProjectPermission(entry.ticket.projectId, 'project:manage-config')
  }
  return { actor, entry }
}

export async function updateTimeEntryAction(input: {
  id: string
  duration?: string
  note?: string | null
  billable?: boolean
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z
      .object({ id: z.string().min(1), duration: z.string().trim().max(40).optional(), note: z.string().trim().max(500).nullable().optional(), billable: z.boolean().optional() })
      .parse(input)
    const { entry } = await ownEntry(data.id, false)
    let minutes: number | undefined
    if (data.duration !== undefined) {
      const parsed = parseDuration(data.duration)
      if (!parsed) return fail('Write a duration like 45m, 1h 30m, 1.5h or 1:30.')
      if (!entry.endedAt) return fail('Stop the timer before changing its duration.')
      minutes = parsed
    }
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        ...(minutes !== undefined ? { minutes } : {}),
        ...(data.note !== undefined ? { note: data.note || null } : {}),
        ...(data.billable !== undefined ? { billable: data.billable } : {}),
      },
    })
    revalidateTime(entry.ticket.key)
    return ok()
  })
}

export async function deleteTimeEntryAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { actor, entry } = await ownEntry(z.string().min(1).parse(id), true)
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.delete({ where: { id: entry.id } })
      if (entry.minutes) {
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'TICKET',
          entityId: entry.ticket.id,
          entityLabel: entry.ticket.key,
          projectId: entry.ticket.projectId,
          ticketId: entry.ticket.id,
          actorId: actor.id,
          field: 'time',
          oldValue: String(entry.minutes),
          summary: `removed ${formatMinutes(entry.minutes)} of logged time from ${entry.ticket.key}`,
        })
      }
    })
    revalidateTime(entry.ticket.key)
    return ok()
  })
}
