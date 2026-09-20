import { prisma } from '@/infrastructure/db/prisma'
import type { Actor } from '@/features/auth/guards'
import { requireProjectView } from '@/features/auth/guards'

/**
 * The weekly status report.
 *
 * Detect in SQL, narrate with the model.
 *
 * Every number below is a query. The model is handed those numbers and asked
 * only to write the paragraph — it never counts anything, never decides what is
 * at risk, and is never in a position to invent a ticket. That split is what
 * makes a generated report safe to send to a client: the prose can be clumsy,
 * but it cannot be wrong about the facts.
 */

/** Anything untouched for this long, and not finished, has stalled. */
const STALL_DAYS = 10

export interface ReportTicket {
  key: string
  title: string
  statusName: string
  assignee: string | null
  days?: number
}

export interface ReportFacts {
  projectName: string
  projectCode: string
  periodDays: number
  completed: ReportTicket[]
  started: ReportTicket[]
  created: ReportTicket[]
  overdue: ReportTicket[]
  blocked: ReportTicket[]
  stalled: ReportTicket[]
  totals: { open: number; done: number; total: number }
}

const TICKET_SHAPE = {
  key: true,
  title: true,
  updatedAt: true,
  status: { select: { name: true } },
  assignee: { select: { name: true } },
} as const

type Row = {
  key: string
  title: string
  updatedAt: Date
  status: { name: string }
  assignee: { name: string } | null
}

function shape(row: Row, days?: number): ReportTicket {
  return {
    key: row.key,
    title: row.title,
    statusName: row.status.name,
    assignee: row.assignee?.name ?? null,
    days,
  }
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000)
}

/**
 * Gathers everything the report talks about. No model involved.
 *
 * Deliberately capped per section: a report listing forty tickets is not a
 * report, and the model would summarise them away anyway.
 */
export async function gatherFacts(
  actor: Actor,
  projectId: string,
  periodDays = 7,
): Promise<ReportFacts> {
  await requireProjectView(projectId)

  const since = new Date(Date.now() - periodDays * 86_400_000)
  const now = new Date()

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, code: true },
  })

  const base = { projectId, isArchived: false }

  const [completed, created, overdue, blocked, stalled, open, done, total] =
    await Promise.all([
      prisma.ticket.findMany({
        where: { ...base, completedAt: { gte: since } },
        select: TICKET_SHAPE,
        orderBy: { completedAt: 'desc' },
        take: 12,
      }),
      prisma.ticket.findMany({
        where: { ...base, createdAt: { gte: since } },
        select: TICKET_SHAPE,
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      prisma.ticket.findMany({
        where: {
          ...base,
          dueDate: { lt: now },
          status: { category: { notIn: ['DONE', 'CANCELLED'] } },
        },
        select: TICKET_SHAPE,
        orderBy: { dueDate: 'asc' },
        take: 12,
      }),
      prisma.ticket.findMany({
        where: { ...base, status: { category: 'BLOCKED' } },
        select: TICKET_SHAPE,
        take: 12,
      }),
      prisma.ticket.findMany({
        where: {
          ...base,
          updatedAt: { lt: new Date(Date.now() - STALL_DAYS * 86_400_000) },
          status: { category: { in: ['IN_PROGRESS', 'REVIEW'] } },
        },
        select: TICKET_SHAPE,
        orderBy: { updatedAt: 'asc' },
        take: 8,
      }),
      prisma.ticket.count({
        where: { ...base, status: { category: { notIn: ['DONE', 'CANCELLED'] } } },
      }),
      prisma.ticket.count({ where: { ...base, status: { category: 'DONE' } } }),
      prisma.ticket.count({ where: base }),
    ])

  // Work that moved into progress during the window, which is not the same as
  // work created in it — the distinction a PM actually reports on.
  const started = await prisma.ticket.findMany({
    where: {
      ...base,
      status: { category: { in: ['IN_PROGRESS', 'REVIEW'] } },
      updatedAt: { gte: since },
      createdAt: { lt: since },
    },
    select: TICKET_SHAPE,
    take: 8,
  })

  return {
    projectName: project.name,
    projectCode: project.code,
    periodDays,
    completed: completed.map((row) => shape(row)),
    started: started.map((row) => shape(row)),
    created: created.map((row) => shape(row)),
    overdue: overdue.map((row) => shape(row)),
    blocked: blocked.map((row) => shape(row)),
    stalled: stalled.map((row) => shape(row, daysSince(row.updatedAt))),
    totals: { open, done, total },
  }
}

/**
 * The facts, written out for the model.
 *
 * Pure, so the prompt can be asserted — and kept dense because every line is
 * sent on a tier that allows 8,000 tokens a minute.
 */
export function factsToPrompt(facts: ReportFacts): string {
  const list = (label: string, tickets: ReportTicket[], withDays = false) => {
    if (tickets.length === 0) return `${label}: none`
    const rendered = tickets
      .map(
        (ticket) =>
          `${ticket.key} "${ticket.title}"${ticket.assignee ? ` (${ticket.assignee})` : ''}` +
          (withDays && ticket.days ? ` [${ticket.days}d untouched]` : ''),
      )
      .join('; ')
    return `${label} (${tickets.length}): ${rendered}`
  }

  return [
    `Project: ${facts.projectName} (${facts.projectCode})`,
    `Period: the last ${facts.periodDays} days`,
    `Totals: ${facts.totals.total} tickets, ${facts.totals.done} done, ${facts.totals.open} open`,
    list('Completed this period', facts.completed),
    list('Moved into progress', facts.started),
    list('Newly raised', facts.created),
    list('Overdue now', facts.overdue),
    list('Blocked now', facts.blocked),
    list('Stalled', facts.stalled, true),
  ].join('\n')
}

/** True when there is genuinely nothing to report, so no call is made. */
export function isQuietPeriod(facts: ReportFacts): boolean {
  return (
    facts.completed.length === 0 &&
    facts.started.length === 0 &&
    facts.created.length === 0 &&
    facts.overdue.length === 0 &&
    facts.blocked.length === 0 &&
    facts.stalled.length === 0
  )
}
