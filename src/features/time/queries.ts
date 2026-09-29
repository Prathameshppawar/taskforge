import { prisma } from '@/infrastructure/db/prisma'
import { ticketVisibilityFilter, type Actor } from '@/features/auth/guards'
import { billedAmount, timerMinutes, weekOf } from '@/core/domain/time'

/** Read models for time: the running timer, a ticket's time, a week, a project. */

export async function getRunningTimer(userId: string) {
  return prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { id: true, startedAt: true, ticket: { select: { id: true, key: true, title: true } } },
  })
}

export type RunningTimer = NonNullable<Awaited<ReturnType<typeof getRunningTimer>>>

/** Minutes an entry counts for now: a running timer counts up to this moment. */
function minutesOf(entry: { minutes: number | null; startedAt: Date; endedAt: Date | null }, now: Date) {
  return entry.minutes ?? (entry.endedAt ? timerMinutes(entry.startedAt, entry.endedAt) : timerMinutes(entry.startedAt, now))
}

export async function getTicketTime(ticketId: string, viewerId: string) {
  const entries = await prisma.timeEntry.findMany({
    where: { ticketId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      minutes: true,
      note: true,
      billable: true,
      source: true,
      user: { select: { id: true, name: true, avatarColor: true } },
    },
    take: 200,
  })
  const now = new Date()
  const people = new Map<string, { id: string; name: string; avatarColor: string; minutes: number }>()
  let total = 0
  let billable = 0
  for (const entry of entries) {
    const minutes = minutesOf(entry, now)
    total += minutes
    if (entry.billable) billable += minutes
    if (entry.user) {
      const person = people.get(entry.user.id) ?? { ...entry.user, minutes: 0 }
      person.minutes += minutes
      people.set(entry.user.id, person)
    }
  }
  return {
    total,
    billable,
    mine: entries.filter((entry) => entry.user?.id === viewerId).reduce((sum, entry) => sum + minutesOf(entry, now), 0),
    running: entries.find((entry) => entry.user?.id === viewerId && !entry.endedAt) ?? null,
    people: [...people.values()].sort((a, b) => b.minutes - a.minutes),
    entries: entries.slice(0, 20).map((entry) => ({ ...entry, counted: minutesOf(entry, now) })),
  }
}

export type TicketTime = Awaited<ReturnType<typeof getTicketTime>>

/** One person's week: a row per ticket, a column per day, in minutes. */
export async function getTimesheet(actor: Actor, userId: string, anyDay: Date) {
  const week = weekOf(anyDay)
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      startedAt: { gte: week.start, lt: week.end },
      ticket: ticketVisibilityFilter(actor),
    },
    select: {
      startedAt: true,
      endedAt: true,
      minutes: true,
      billable: true,
      ticket: { select: { id: true, key: true, title: true, project: { select: { id: true, name: true } } } },
    },
    orderBy: { startedAt: 'asc' },
  })
  const now = new Date()
  const rows = new Map<string, { ticket: (typeof entries)[number]['ticket']; days: number[]; total: number }>()
  const totals = Array.from({ length: 7 }, () => 0)
  for (const entry of entries) {
    const index = Math.floor((entry.startedAt.getTime() - week.start.getTime()) / 86_400_000)
    const minutes = minutesOf(entry, now)
    const row = rows.get(entry.ticket.id) ?? { ticket: entry.ticket, days: Array.from({ length: 7 }, () => 0), total: 0 }
    row.days[index] += minutes
    row.total += minutes
    totals[index] += minutes
    rows.set(entry.ticket.id, row)
  }
  return {
    week,
    rows: [...rows.values()].sort((a, b) => b.total - a.total),
    totals,
    total: totals.reduce((sum, value) => sum + value, 0),
  }
}

export type Timesheet = Awaited<ReturnType<typeof getTimesheet>>

/**
 * A project's time over a period: by person and by kind of work, billable
 * and not, and what the billable part comes to at the project's rate.
 */
export async function getProjectTime(projectId: string, from: Date, to: Date) {
  const [entries, settings] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { ticket: { projectId }, startedAt: { gte: from, lt: to } },
      select: {
        minutes: true,
        startedAt: true,
        endedAt: true,
        billable: true,
        user: { select: { id: true, name: true, avatarColor: true } },
        ticket: { select: { key: true, title: true, type: { select: { kind: true } } } },
      },
    }),
    prisma.projectSettings.findUnique({ where: { projectId }, select: { hourlyRate: true, currency: true } }),
  ])
  const now = new Date()
  const people = new Map<string, { id: string; name: string; avatarColor: string; minutes: number; billable: number }>()
  const kinds = new Map<string, number>()
  const tickets = new Map<string, { key: string; title: string; minutes: number }>()
  let total = 0
  let billable = 0
  for (const entry of entries) {
    const minutes = minutesOf(entry, now)
    total += minutes
    if (entry.billable) billable += minutes
    kinds.set(entry.ticket.type.kind, (kinds.get(entry.ticket.type.kind) ?? 0) + minutes)
    const ticket = tickets.get(entry.ticket.key) ?? { key: entry.ticket.key, title: entry.ticket.title, minutes: 0 }
    ticket.minutes += minutes
    tickets.set(entry.ticket.key, ticket)
    if (entry.user) {
      const person = people.get(entry.user.id) ?? { ...entry.user, minutes: 0, billable: 0 }
      person.minutes += minutes
      if (entry.billable) person.billable += minutes
      people.set(entry.user.id, person)
    }
  }
  const rate = settings?.hourlyRate === null || settings?.hourlyRate === undefined ? null : Number(settings.hourlyRate)
  return {
    total,
    billable,
    rate,
    currency: settings?.currency ?? 'USD',
    amount: rate === null ? null : billedAmount(billable, rate),
    people: [...people.values()].sort((a, b) => b.minutes - a.minutes),
    kinds: [...kinds.entries()].map(([kind, minutes]) => ({ kind, minutes })).sort((a, b) => b.minutes - a.minutes),
    tickets: [...tickets.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 10),
  }
}

export type ProjectTime = Awaited<ReturnType<typeof getProjectTime>>
