'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission, requireActor } from '@/features/auth/guards'
import { firstOccurrence } from '@/core/domain/recurrence'
import { ok, type ActionResult } from '@/core/domain/result'
import { ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import {
  deleteRecurringSchema,
  recurringSchema,
  toggleRecurringSchema,
  type DeleteRecurringInput,
  type RecurringInput,
  type ToggleRecurringInput,
} from './schemas'

export async function upsertRecurringAction(
  input: RecurringInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = recurringSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'recurring:manage')

    // The first run is derived, never supplied — it must match the rule.
    const nextRunAt = firstOccurrence({
      frequency: data.frequency,
      interval: data.interval,
      dayOfWeek: data.dayOfWeek,
      dayOfMonth: data.dayOfMonth,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
    })

    const payload = {
      projectId: data.projectId,
      name: data.name,
      title: data.title,
      description: data.description || null,
      statusId: data.statusId,
      priorityId: data.priorityId,
      typeId: data.typeId,
      assigneeId: data.assigneeId || null,
      frequency: data.frequency,
      interval: data.interval,
      dayOfWeek: data.dayOfWeek ?? null,
      dayOfMonth: data.dayOfMonth ?? null,
      dueInDays: data.dueInDays ?? null,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      isActive: data.isActive,
    }

    const schedule = await prisma.$transaction(async (tx) => {
      let record: { id: string }

      if (data.id) {
        const existing = await tx.recurringTicket.findFirst({
          where: { id: data.id, projectId: data.projectId },
          select: { id: true, nextRunAt: true },
        })
        if (!existing) throw new NotFoundError('Recurring schedule', data.id)

        record = await tx.recurringTicket.update({
          where: { id: data.id },
          data: {
            ...payload,
            // Only reset the next run if it would now be in the past.
            nextRunAt: existing.nextRunAt < new Date() ? nextRunAt : undefined,
          },
          select: { id: true },
        })

        await tx.recurringTicketLabel.deleteMany({ where: { recurringTicketId: data.id } })
      } else {
        record = await tx.recurringTicket.create({
          data: { ...payload, nextRunAt, createdById: actor.id },
          select: { id: true },
        })
      }

      if (data.labelIds.length > 0) {
        const valid = await tx.label.findMany({
          where: { id: { in: data.labelIds }, projectId: data.projectId },
          select: { id: true },
        })
        if (valid.length > 0) {
          await tx.recurringTicketLabel.createMany({
            data: valid.map((label) => ({
              recurringTicketId: record.id,
              labelId: label.id,
            })),
            skipDuplicates: true,
          })
        }
      }

      await recordActivity(tx, {
        action: data.id ? 'UPDATED' : 'CREATED',
        entityType: 'RECURRING_TICKET',
        entityId: record.id,
        entityLabel: data.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `${data.id ? 'updated' : 'created'} the recurring schedule "${data.name}"`,
      })

      return record
    })

    revalidatePath(`/projects/${data.projectId}/recurring`)
    return ok({ id: schedule.id })
  })
}

export async function toggleRecurringAction(
  input: ToggleRecurringInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = toggleRecurringSchema.parse(input)

    const schedule = await prisma.recurringTicket.findUnique({
      where: { id: data.id },
      select: { id: true, name: true, projectId: true, nextRunAt: true },
    })
    if (!schedule) throw new NotFoundError('Recurring schedule', data.id)

    const { actor } = await requireProjectPermission(schedule.projectId, 'recurring:manage')

    await prisma.$transaction(async (tx) => {
      await tx.recurringTicket.update({
        where: { id: data.id },
        data: { isActive: data.isActive },
      })

      await recordActivity(tx, {
        action: data.isActive ? 'ACTIVATED' : 'DEACTIVATED',
        entityType: 'RECURRING_TICKET',
        entityId: data.id,
        entityLabel: schedule.name,
        projectId: schedule.projectId,
        actorId: actor.id,
        summary: `${data.isActive ? 'resumed' : 'paused'} the recurring schedule "${schedule.name}"`,
      })
    })

    revalidatePath(`/projects/${schedule.projectId}/recurring`)
    return ok()
  })
}

export async function deleteRecurringAction(
  input: DeleteRecurringInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteRecurringSchema.parse(input)

    const schedule = await prisma.recurringTicket.findUnique({
      where: { id: data.id },
      select: { id: true, name: true, projectId: true, _count: { select: { generatedTickets: true } } },
    })
    if (!schedule) throw new NotFoundError('Recurring schedule', data.id)

    const { actor } = await requireProjectPermission(schedule.projectId, 'recurring:manage')

    await prisma.$transaction(async (tx) => {
      // Tickets already generated survive — the FK is SET NULL. Deleting the
      // schedule stops future work, it does not erase past work.
      await tx.recurringTicket.delete({ where: { id: data.id } })

      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'RECURRING_TICKET',
        entityId: data.id,
        entityLabel: schedule.name,
        projectId: schedule.projectId,
        actorId: actor.id,
        summary: `deleted the recurring schedule "${schedule.name}" (${schedule._count.generatedTickets} tickets it created are kept)`,
      })
    })

    revalidatePath(`/projects/${schedule.projectId}/recurring`)
    return ok()
  })
}

/** Manual trigger, for testing a schedule without waiting for the cron. */
export async function runRecurringNowAction(
  scheduleId: string,
): Promise<ActionResult<{ ticketKey: string | null }>> {
  return runAction(async () => {
    // Called for its guard, not its value: it throws when the caller is not
    // signed in, which is the only reason it is here.
    await requireActor()

    const schedule = await prisma.recurringTicket.findUnique({
      where: { id: scheduleId },
      select: { projectId: true, nextRunAt: true, isActive: true },
    })
    if (!schedule) throw new NotFoundError('Recurring schedule', scheduleId)

    await requireProjectPermission(schedule.projectId, 'recurring:manage')
    if (!schedule.isActive) {
      throw new ForbiddenError('This schedule is paused. Resume it before running it.')
    }

    const { generateDueTickets } = await import('./service')

    // Pull the schedule's next run forward so this sweep picks it up, then let
    // the normal generator handle numbering, labels and audit.
    await prisma.recurringTicket.update({
      where: { id: scheduleId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    })

    const result = await generateDueTickets(prisma)
    const created = result.generated.find((entry) => entry.scheduleId === scheduleId)

    revalidatePath(`/projects/${schedule.projectId}`, 'layout')
    return ok({ ticketKey: created?.ticketKey ?? null })
  })
}
