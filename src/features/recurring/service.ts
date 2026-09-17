import type { Prisma, PrismaClient } from '@prisma/client'

import { buildTicketKey } from '@/core/domain/ticket-rules'
import { nextOccurrence } from '@/core/domain/recurrence'
import { recordActivity } from '@/features/activity/service'

/**
 * Recurring ticket generation.
 *
 * Invoked by the scheduler (/api/cron/recurring). Written to be safe to run
 * more often than needed and safe to miss a run:
 *
 *   • Each schedule advances by walking nextRunAt forward until it is in the
 *     future, so a missed day does not silently skip an occurrence, and a
 *     long outage does not produce one ticket per missed period either — it
 *     generates once and catches the schedule up.
 *   • Each schedule is processed in its own transaction, so one failure does
 *     not abort the rest of the sweep.
 */

export interface GenerationResult {
  generated: Array<{ scheduleId: string; scheduleName: string; ticketKey: string }>
  deactivated: string[]
  errors: Array<{ scheduleId: string; message: string }>
}

export async function generateDueTickets(
  prisma: PrismaClient,
  now = new Date(),
): Promise<GenerationResult> {
  const due = await prisma.recurringTicket.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
      startDate: { lte: now },
    },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      projectId: true,
      statusId: true,
      priorityId: true,
      typeId: true,
      assigneeId: true,
      frequency: true,
      interval: true,
      dayOfWeek: true,
      dayOfMonth: true,
      dueInDays: true,
      startDate: true,
      endDate: true,
      nextRunAt: true,
      createdById: true,
      project: { select: { code: true, isArchived: true } },
      labels: { select: { labelId: true } },
    },
  })

  const result: GenerationResult = { generated: [], deactivated: [], errors: [] }

  for (const schedule of due) {
    // An archived project should not keep accruing work.
    if (schedule.project.isArchived) {
      await prisma.recurringTicket.update({
        where: { id: schedule.id },
        data: { isActive: false },
      })
      result.deactivated.push(schedule.id)
      continue
    }

    // Past its end date — retire it.
    if (schedule.endDate && schedule.endDate < now) {
      await prisma.recurringTicket.update({
        where: { id: schedule.id },
        data: { isActive: false },
      })
      result.deactivated.push(schedule.id)
      continue
    }

    try {
      const ticketKey = await prisma.$transaction(async (tx) => {
        const settings = await tx.projectSettings.update({
          where: { projectId: schedule.projectId },
          data: { nextTicketNumber: { increment: 1 } },
          select: { nextTicketNumber: true },
        })
        const number = settings.nextTicketNumber - 1
        const key = buildTicketKey(schedule.project.code, number)

        const dueDate =
          schedule.dueInDays != null
            ? new Date(now.getTime() + schedule.dueInDays * 86_400_000)
            : null

        const ticket = await tx.ticket.create({
          data: {
            projectId: schedule.projectId,
            number,
            key,
            title: schedule.title,
            description: schedule.description,
            statusId: schedule.statusId,
            priorityId: schedule.priorityId,
            typeId: schedule.typeId,
            assigneeId: schedule.assigneeId,
            reporterId: schedule.createdById,
            createdById: schedule.createdById,
            recurringTicketId: schedule.id,
            dueDate,
            position: number * 1000,
            labels: {
              create: schedule.labels.map((label) => ({ labelId: label.labelId })),
            },
          },
          select: { id: true, key: true },
        })

        /*
         * Advance past every occurrence already in the past. Without this loop
         * a schedule that missed several runs would fire once per sweep until
         * it caught up, flooding the board.
         */
        let next = nextOccurrence(
          {
            frequency: schedule.frequency,
            interval: schedule.interval,
            dayOfWeek: schedule.dayOfWeek,
            dayOfMonth: schedule.dayOfMonth,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
          },
          schedule.nextRunAt,
        )

        let guard = 0
        while (next && next <= now && guard++ < 500) {
          next = nextOccurrence(
            {
              frequency: schedule.frequency,
              interval: schedule.interval,
              dayOfWeek: schedule.dayOfWeek,
              dayOfMonth: schedule.dayOfMonth,
              startDate: schedule.startDate,
              endDate: schedule.endDate,
            },
            next,
          )
        }

        await tx.recurringTicket.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            runCount: { increment: 1 },
            ...(next ? { nextRunAt: next } : { isActive: false }),
          },
        })

        await recordActivity(tx, {
          action: 'CREATED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId: schedule.projectId,
          ticketId: ticket.id,
          actorId: schedule.createdById,
          summary: `generated ${ticket.key} from the recurring schedule "${schedule.name}"`,
        })

        return ticket.key
      })

      result.generated.push({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        ticketKey,
      })
    } catch (error) {
      // One bad schedule must not stop the rest of the sweep.
      result.errors.push({
        scheduleId: schedule.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return result
}

export type Tx = Prisma.TransactionClient
