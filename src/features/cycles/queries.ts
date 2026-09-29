import type { Prisma, StatusCategory } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { ticketVisibilityFilter, type Actor } from '@/features/auth/guards'
import { burnup } from '@/core/domain/cycles'

/**
 * Read models for planning: the backlog, the open cycles, and a cycle's
 * burn-up.
 */

const OPEN: StatusCategory[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW']

const PLAN_TICKET = {
  id: true,
  key: true,
  title: true,
  storyPoints: true,
  estimateHours: true,
  backlogRank: true,
  cycleId: true,
  dueDate: true,
  status: { select: { id: true, name: true, color: true, category: true } },
  priority: { select: { id: true, name: true, color: true, level: true } },
  type: { select: { name: true, color: true } },
  assignee: { select: { id: true, name: true, avatarColor: true } },
  linksIn: {
    where: { type: 'BLOCKS', source: { status: { category: { in: OPEN } } } },
    select: { source: { select: { key: true } } },
  },
} satisfies Prisma.TicketSelect

export type PlanTicket = {
  id: string
  key: string
  title: string
  storyPoints: number | null
  estimateHours: number | null
  backlogRank: number | null
  cycleId: string | null
  dueDate: Date | null
  status: { id: string; name: string; color: string; category: string }
  priority: { id: string; name: string; color: string; level: number }
  type: { name: string; color: string }
  assignee: { id: string; name: string; avatarColor: string } | null
  blockedBy: string[]
}

function toPlanTicket(row: Awaited<ReturnType<typeof loadTickets>>[number]): PlanTicket {
  const { linksIn, estimateHours, ...rest } = row
  return {
    ...rest,
    estimateHours: estimateHours === null ? null : Number(estimateHours),
    blockedBy: linksIn.map((link) => link.source.key),
  }
}

function loadTickets(where: Prisma.TicketWhereInput) {
  return prisma.ticket.findMany({
    where,
    select: PLAN_TICKET,
    // Ranked first, then the order people already expect: priority, then age.
    orderBy: [{ backlogRank: { sort: 'asc', nulls: 'last' } }, { priority: { level: 'desc' } }, { number: 'asc' }],
    take: 500,
  })
}

/**
 * Whether a project plans in story points or ticket counts: points as soon as
 * anything in it has been pointed. One answer per project, so the planning
 * page and a cycle's burn-up never disagree.
 */
export async function projectUnit(projectId: string): Promise<'points' | 'tickets'> {
  const pointed = await prisma.ticket.count({ where: { projectId, storyPoints: { gt: 0 } }, take: 1 })
  return pointed > 0 ? 'points' : 'tickets'
}

export async function getPlanning(actor: Actor, projectId: string) {
  const visible = ticketVisibilityFilter(actor)
  const [cycles, backlog, closed] = await Promise.all([
    prisma.cycle.findMany({
      where: { projectId, state: { not: 'CLOSED' } },
      orderBy: [{ state: 'asc' }, { startDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),
    loadTickets({ AND: [visible, { projectId, cycleId: null, isArchived: false, status: { category: { in: OPEN } } }] }),
    prisma.cycle.findMany({
      where: { projectId, state: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      take: 6,
      select: { id: true, name: true, kind: true, closedAt: true, summary: true },
    }),
  ])
  const inCycles = cycles.length
    ? await loadTickets({ AND: [visible, { cycleId: { in: cycles.map((cycle) => cycle.id) }, isArchived: false }] })
    : []

  return {
    unit: await projectUnit(projectId),
    cycles: cycles.map((cycle) => ({
      ...cycle,
      tickets: inCycles.filter((ticket) => ticket.cycleId === cycle.id).map(toPlanTicket),
    })),
    backlog: backlog.map(toPlanTicket),
    closed,
  }
}

export type Planning = Awaited<ReturnType<typeof getPlanning>>

export async function getCycleDetail(actor: Actor, cycleId: string) {
  const cycle = await prisma.cycle.findUnique({ where: { id: cycleId } })
  if (!cycle) return null

  // Everything that was ever in the cycle, so the burn-up can show scope that
  // was added and later removed.
  const everIn = await prisma.ticketCycleChange.findMany({
    where: { OR: [{ toCycleId: cycleId }, { fromCycleId: cycleId }] },
    select: { ticketId: true },
    distinct: ['ticketId'],
  })
  const histories = await prisma.ticket.findMany({
    where: { AND: [ticketVisibilityFilter(actor), { id: { in: everIn.map((row) => row.ticketId) } }] },
    select: {
      id: true,
      storyPoints: true,
      cycleHistory: { select: { toCycleId: true, changedAt: true } },
      statusHistory: { select: { toCategory: true, changedAt: true } },
    },
  })
  const current = await loadTickets({ AND: [ticketVisibilityFilter(actor), { cycleId, isArchived: false }] })

  const unit = await projectUnit(cycle.projectId)
  const now = new Date()
  const start = cycle.startDate ?? cycle.startedAt ?? cycle.createdAt
  const series = burnup({
    cycleId,
    start,
    end: cycle.closedAt ?? cycle.endDate,
    now,
    unit,
    tickets: histories.map((ticket) => ({
      id: ticket.id,
      points: ticket.storyPoints,
      cycleChanges: ticket.cycleHistory,
      statusChanges: ticket.statusHistory,
    })),
  })

  return {
    cycle,
    unit,
    series,
    tickets: current.map(toPlanTicket),
  }
}

export type CycleDetail = NonNullable<Awaited<ReturnType<typeof getCycleDetail>>>
