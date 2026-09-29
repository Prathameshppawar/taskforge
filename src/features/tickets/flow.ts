import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { agentUserId } from '@/features/agents/service'
import { notify } from '@/features/notifications/service'
import {
  averageTimeInStatus,
  dueAlerts,
  formatDuration,
  slaApplies,
  slaClocks,
  timeInStatus,
  type Clock,
  type StatusChange,
} from '@/core/domain/flow'

/**
 * Flow facts for one ticket, and the sweep that sends SLA alerts.
 *
 * The history is kept by triggers (see the TicketStatusChange model); this
 * file only reads it.
 */

export async function getTicketFlow(ticketId: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: {
      createdAt: true,
      completedAt: true,
      firstResponseAt: true,
      statusChangedAt: true,
      type: { select: { kind: true } },
      priority: { select: { name: true, respondWithinHours: true, resolveWithinHours: true } },
      project: { select: { settings: { select: { slaKinds: true, stuckAfterDays: true } }, statuses: { select: { id: true, name: true, color: true } } } },
      statusHistory: { select: { toStatusId: true, toCategory: true, changedAt: true }, orderBy: { changedAt: 'asc' } },
    },
  })
  const now = new Date()
  const names = new Map(ticket.project.statuses.map((status) => [status.id, status]))
  const time = timeInStatus(ticket.statusHistory, now).map((entry) => ({
    ...entry,
    name: (entry.statusId && names.get(entry.statusId)?.name) ?? entry.category.replace('_', ' ').toLowerCase(),
    color: (entry.statusId && names.get(entry.statusId)?.color) ?? 'slate',
    label: formatDuration(entry.ms),
  }))

  const applies = slaApplies(ticket.type.kind, ticket.project.settings?.slaKinds ?? '')
  const clocks = applies
    ? slaClocks({
        createdAt: ticket.createdAt,
        firstResponseAt: ticket.firstResponseAt,
        completedAt: ticket.completedAt,
        changes: ticket.statusHistory,
        respondWithinHours: ticket.priority.respondWithinHours,
        resolveWithinHours: ticket.priority.resolveWithinHours,
        now,
      })
    : { respond: null, resolve: null }

  return {
    time,
    changes: ticket.statusHistory.length,
    sla: clocks.respond || clocks.resolve ? { priority: ticket.priority.name, ...clocks } : null,
  }
}

export type TicketFlow = Awaited<ReturnType<typeof getTicketFlow>>

const ALERT_COPY: Record<string, (key: string, clock: Clock, target: string) => string> = {
  'respond:warn': (key, clock) => `${key} needs a first response within ${formatDuration(clock.budgetMs - clock.spentMs)}`,
  'respond:breach': (key, _clock, target) => `${key} missed its ${target} response target`,
  'resolve:warn': (key, clock) => `${key} must be resolved within ${formatDuration(clock.budgetMs - clock.spentMs)}`,
  'resolve:breach': (key, _clock, target) => `${key} missed its ${target} resolution target`,
}

/**
 * Sends each response and resolution alert once per ticket: at 80% of the
 * target, and when it passes. To the assignee and the project's managers, as
 * TaskForge Ops. Run every five minutes by the monitors cron.
 */
export async function sweepSlaAlerts(now = new Date()): Promise<{ checked: number; sent: number }> {
  const tickets = await prisma.ticket.findMany({
    where: {
      completedAt: null,
      isArchived: false,
      OR: [{ priority: { respondWithinHours: { not: null } } }, { priority: { resolveWithinHours: { not: null } } }],
    },
    select: {
      id: true,
      key: true,
      title: true,
      projectId: true,
      createdAt: true,
      completedAt: true,
      firstResponseAt: true,
      assigneeId: true,
      type: { select: { kind: true } },
      priority: { select: { respondWithinHours: true, resolveWithinHours: true } },
      project: { select: { ownerId: true, settings: { select: { slaKinds: true } } } },
      statusHistory: { select: { toStatusId: true, toCategory: true, changedAt: true } },
      slaAlerts: { select: { kind: true } },
    },
    take: 2000,
  })

  let checked = 0
  let sent = 0
  let actorId: string | null = null
  const managers = new Map<string, string[]>()

  for (const ticket of tickets) {
    if (!slaApplies(ticket.type.kind, ticket.project.settings?.slaKinds ?? '')) continue
    checked++
    const clocks = slaClocks({
      createdAt: ticket.createdAt,
      firstResponseAt: ticket.firstResponseAt,
      completedAt: ticket.completedAt,
      changes: ticket.statusHistory as StatusChange[],
      respondWithinHours: ticket.priority.respondWithinHours,
      resolveWithinHours: ticket.priority.resolveWithinHours,
      now,
    })
    const already = new Set(ticket.slaAlerts.map((alert) => alert.kind))
    const pending = [
      ...dueAlerts('respond', clocks.respond).map((kind) => ({ kind, clock: clocks.respond!, hours: ticket.priority.respondWithinHours! })),
      ...dueAlerts('resolve', clocks.resolve).map((kind) => ({ kind, clock: clocks.resolve!, hours: ticket.priority.resolveWithinHours! })),
    ].filter((alert) => !already.has(alert.kind))
    if (pending.length === 0) continue

    // A breach found on the first look also satisfies its warning: record
    // both, but tell people only the worse news.
    const toSend = pending.filter((alert) => !(alert.kind.endsWith(':warn') && pending.some((other) => other.kind === alert.kind.replace(':warn', ':breach'))))

    actorId ??= await agentUserId('ops')
    if (!managers.has(ticket.projectId)) {
      const rows = await prisma.projectMember.findMany({
        where: { projectId: ticket.projectId, role: 'MANAGER', user: { isActive: true } },
        select: { userId: true },
      })
      managers.set(ticket.projectId, rows.map((row) => row.userId))
    }
    const recipients = [ticket.assigneeId, ticket.project.ownerId, ...managers.get(ticket.projectId)!].filter((id): id is string => Boolean(id))
    const actor = actorId

    await prisma.$transaction(async (tx) => {
      // The insert is the lock: a concurrent sweep that lost the race skips.
      const claimed = await tx.ticketSlaAlert.createMany({
        data: pending.map((alert) => ({ ticketId: ticket.id, kind: alert.kind })),
        skipDuplicates: true,
      })
      if (claimed.count === 0) return
      for (const alert of toSend) {
        const title = ALERT_COPY[alert.kind](ticket.key, alert.clock, `${alert.hours}h`)
        await notify(tx, {
          userIds: recipients,
          type: alert.kind.endsWith(':breach') ? 'SLA_BREACHED' : 'SLA_AT_RISK',
          actorId: actor,
          ticketId: ticket.id,
          title,
          body: ticket.title,
        })
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId: ticket.projectId,
          ticketId: ticket.id,
          actorId: actor,
          field: 'sla',
          newValue: alert.kind,
          summary: title.replace(ticket.key, 'this ticket'),
        })
        sent++
      }
    })
  }

  return { checked, sent }
}

/**
 * A project's flow over the last 90 days: where finished work waited, how
 * long it took from start to done, how often service targets were met, and
 * what is stuck right now.
 */
export async function getProjectFlow(projectId: string) {
  const now = new Date()
  const since = new Date(now.getTime() - 90 * 86_400_000)
  const [finished, settings, statuses, open] = await Promise.all([
    prisma.ticket.findMany({
      where: { projectId, completedAt: { gte: since }, status: { category: 'DONE' } },
      select: {
        createdAt: true,
        completedAt: true,
        firstResponseAt: true,
        type: { select: { kind: true } },
        priority: { select: { respondWithinHours: true, resolveWithinHours: true } },
        statusHistory: { select: { toStatusId: true, toCategory: true, changedAt: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 500,
    }),
    prisma.projectSettings.findUnique({ where: { projectId }, select: { stuckAfterDays: true, slaKinds: true } }),
    prisma.status.findMany({ where: { projectId }, select: { id: true, name: true, color: true } }),
    prisma.ticket.findMany({
      where: { projectId, isArchived: false, completedAt: null, status: { category: { in: ['IN_PROGRESS', 'REVIEW', 'BLOCKED'] } } },
      select: { statusChangedAt: true },
    }),
  ])
  const names = new Map(statuses.map((status) => [status.id, status]))

  const waits = averageTimeInStatus(
    finished.map((ticket) => ({ changes: ticket.statusHistory, completedAt: ticket.completedAt! })),
  ).map((entry) => ({
    ...entry,
    name: (entry.statusId && names.get(entry.statusId)?.name) ?? entry.category.replace('_', ' ').toLowerCase(),
    color: (entry.statusId && names.get(entry.statusId)?.color) ?? 'slate',
    label: formatDuration(entry.avgMs),
  }))

  // Cycle time: first move into In Progress (or later) to done.
  const cycles = finished
    .map((ticket) => {
      const started = ticket.statusHistory
        .filter((change) => !['BACKLOG', 'TODO'].includes(change.toCategory))
        .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())[0]
      return started ? ticket.completedAt!.getTime() - started.changedAt.getTime() : null
    })
    .filter((value): value is number => value !== null && value >= 0)
    .sort((a, b) => a - b)
  const median = cycles.length ? cycles[Math.floor((cycles.length - 1) / 2)] : null

  let targeted = 0
  let met = 0
  for (const ticket of finished) {
    if (!slaApplies(ticket.type.kind, settings?.slaKinds ?? '')) continue
    const clocks = slaClocks({
      createdAt: ticket.createdAt,
      firstResponseAt: ticket.firstResponseAt,
      completedAt: ticket.completedAt,
      changes: ticket.statusHistory,
      respondWithinHours: ticket.priority.respondWithinHours,
      resolveWithinHours: ticket.priority.resolveWithinHours,
      now,
    })
    const results = [clocks.respond, clocks.resolve].filter((clock): clock is Clock => clock !== null)
    if (results.length === 0) continue
    targeted++
    if (results.every((clock) => clock.state === 'met')) met++
  }

  const stuckAfter = settings?.stuckAfterDays ?? null
  const stuckNow = stuckAfter
    ? open.filter((ticket) => now.getTime() - ticket.statusChangedAt.getTime() >= stuckAfter * 86_400_000).length
    : null

  return {
    finished: finished.length,
    waits,
    medianCycle: median === null ? null : formatDuration(median),
    sla: targeted ? { met, targeted, percent: Math.round((met / targeted) * 100) } : null,
    stuckNow,
    stuckAfter,
  }
}

export type ProjectFlow = Awaited<ReturnType<typeof getProjectFlow>>
