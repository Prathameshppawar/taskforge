import { prisma } from '@/infrastructure/db/prisma'
import { ticketVisibilityFilter, projectVisibilityFilter, type Actor } from '@/features/auth/guards'
import { COMPLETED_CATEGORIES } from '@/core/domain/ticket-rules'

/**
 * Analytics read models.
 *
 * Aggregates are computed with groupBy/count in the database rather than by
 * loading ticket rows into memory — the dashboard must stay cheap as the
 * workspace grows.
 */

export interface StatCounts {
  total: number
  open: number
  inProgress: number
  blocked: number
  done: number
  overdue: number
  unassigned: number
}

type Scope = { projectId?: string; assigneeId?: string }

function scopeWhere(actor: Actor, scope: Scope) {
  return {
    isArchived: false,
    ...ticketVisibilityFilter(actor),
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.assigneeId ? { assigneeId: scope.assigneeId } : {}),
  }
}

export async function getStatCounts(actor: Actor, scope: Scope = {}): Promise<StatCounts> {
  const base = scopeWhere(actor, scope)

  const [byCategory, total, overdue, unassigned] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['statusId'],
      where: base,
      _count: { _all: true },
    }),
    prisma.ticket.count({ where: base }),
    prisma.ticket.count({
      where: {
        ...base,
        dueDate: { lt: new Date() },
        status: { category: { notIn: ['DONE', 'CANCELLED'] } },
      },
    }),
    prisma.ticket.count({ where: { ...base, assigneeId: null } }),
  ])

  // Map status ids to their semantic category in one extra query rather than
  // joining per group.
  const statusIds = byCategory.map((row) => row.statusId)
  const statuses = await prisma.status.findMany({
    where: { id: { in: statusIds } },
    select: { id: true, category: true },
  })
  const categoryById = new Map(statuses.map((s) => [s.id, s.category]))

  const counts: Record<string, number> = {}
  for (const row of byCategory) {
    const category = categoryById.get(row.statusId) ?? 'BACKLOG'
    counts[category] = (counts[category] ?? 0) + row._count._all
  }

  return {
    total,
    open: (counts.BACKLOG ?? 0) + (counts.TODO ?? 0),
    inProgress: (counts.IN_PROGRESS ?? 0) + (counts.REVIEW ?? 0),
    blocked: counts.BLOCKED ?? 0,
    done: counts.DONE ?? 0,
    overdue,
    unassigned,
  }
}

/** Completion percentage, excluding cancelled tickets from the denominator. */
export async function getCompletionRate(actor: Actor, scope: Scope = {}) {
  const base = scopeWhere(actor, scope)

  const [countable, completed] = await Promise.all([
    prisma.ticket.count({
      where: { ...base, status: { category: { not: 'CANCELLED' } } },
    }),
    prisma.ticket.count({
      where: { ...base, status: { category: { in: [...COMPLETED_CATEGORIES] } } },
    }),
  ])

  return {
    countable,
    completed,
    percent: countable === 0 ? 0 : Math.round((completed / countable) * 100),
  }
}

export interface TrendPoint {
  date: string
  created: number
  completed: number
}

/**
 * Created vs completed per day over the trailing window.
 *
 * Two raw queries rather than a groupBy on a computed date expression, which
 * Prisma cannot express — the date truncation happens in SQL.
 */
export async function getTicketTrend(
  actor: Actor,
  scope: Scope = {},
  days = 30,
): Promise<TrendPoint[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)

  const base = scopeWhere(actor, scope)

  const [created, completed] = await Promise.all([
    prisma.ticket.findMany({
      where: { ...base, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.ticket.findMany({
      where: { ...base, completedAt: { gte: since } },
      select: { completedAt: true },
    }),
  ])

  const buckets = new Map<string, TrendPoint>()
  for (let index = 0; index <= days; index++) {
    const date = new Date(since)
    date.setDate(date.getDate() + index)
    const key = date.toISOString().slice(0, 10)
    buckets.set(key, { date: key, created: 0, completed: 0 })
  }

  for (const ticket of created) {
    const key = ticket.createdAt.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (bucket) bucket.created++
  }

  for (const ticket of completed) {
    if (!ticket.completedAt) continue
    const key = ticket.completedAt.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (bucket) bucket.completed++
  }

  return [...buckets.values()]
}

export interface DistributionSlice {
  id: string
  name: string
  color: string
  count: number
  level?: number
}

export async function getPriorityDistribution(
  actor: Actor,
  scope: Scope = {},
): Promise<DistributionSlice[]> {
  const grouped = await prisma.ticket.groupBy({
    by: ['priorityId'],
    where: scopeWhere(actor, scope),
    _count: { _all: true },
  })

  const priorities = await prisma.priority.findMany({
    where: { id: { in: grouped.map((row) => row.priorityId) } },
    select: { id: true, name: true, color: true, level: true },
  })

  const countById = new Map(grouped.map((row) => [row.priorityId, row._count._all]))

  // Aggregate by NAME: several projects each own a "High" row, and the chart
  // should show one bar per severity, not one per project.
  const byName = new Map<string, DistributionSlice>()
  for (const priority of priorities) {
    const existing = byName.get(priority.name)
    const count = countById.get(priority.id) ?? 0
    if (existing) {
      existing.count += count
    } else {
      byName.set(priority.name, {
        id: priority.name,
        name: priority.name,
        color: priority.color,
        count,
        level: priority.level,
      })
    }
  }

  return [...byName.values()].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
}

export async function getStatusDistribution(
  actor: Actor,
  scope: Scope = {},
): Promise<DistributionSlice[]> {
  const grouped = await prisma.ticket.groupBy({
    by: ['statusId'],
    where: scopeWhere(actor, scope),
    _count: { _all: true },
  })

  const statuses = await prisma.status.findMany({
    where: { id: { in: grouped.map((row) => row.statusId) } },
    select: { id: true, name: true, color: true, position: true },
  })

  const countById = new Map(grouped.map((row) => [row.statusId, row._count._all]))

  const byName = new Map<string, DistributionSlice & { position: number }>()
  for (const status of statuses) {
    const count = countById.get(status.id) ?? 0
    const existing = byName.get(status.name)
    if (existing) existing.count += count
    else {
      byName.set(status.name, {
        id: status.name,
        name: status.name,
        color: status.color,
        count,
        position: status.position,
      })
    }
  }

  return [...byName.values()].sort((a, b) => a.position - b.position)
}

export async function getLabelDistribution(
  actor: Actor,
  scope: Scope = {},
  limit = 10,
): Promise<DistributionSlice[]> {
  const grouped = await prisma.ticketLabel.groupBy({
    by: ['labelId'],
    where: { ticket: scopeWhere(actor, scope) },
    _count: { _all: true },
    orderBy: { _count: { labelId: 'desc' } },
    take: limit,
  })

  if (grouped.length === 0) return []

  const labels = await prisma.label.findMany({
    where: { id: { in: grouped.map((row) => row.labelId) } },
    select: { id: true, name: true, color: true },
  })
  const labelById = new Map(labels.map((label) => [label.id, label]))

  return grouped
    .map((row) => {
      const label = labelById.get(row.labelId)
      if (!label) return null
      return {
        id: label.id,
        name: label.name,
        color: label.color,
        count: row._count._all,
      }
    })
    .filter((slice): slice is DistributionSlice => slice !== null)
}

export interface WorkloadRow {
  userId: string
  name: string
  avatarColor: string
  open: number
  inProgress: number
  blocked: number
  done: number
  total: number
  overdue: number
}

/** Per-assignee workload, split by status category. */
export async function getTeamWorkload(
  actor: Actor,
  scope: Scope = {},
): Promise<WorkloadRow[]> {
  const tickets = await prisma.ticket.findMany({
    where: { ...scopeWhere(actor, scope), assigneeId: { not: null } },
    select: {
      assigneeId: true,
      dueDate: true,
      assignee: { select: { id: true, name: true, avatarColor: true } },
      status: { select: { category: true } },
    },
  })

  const rows = new Map<string, WorkloadRow>()
  const now = Date.now()

  for (const ticket of tickets) {
    if (!ticket.assignee) continue

    let row = rows.get(ticket.assignee.id)
    if (!row) {
      row = {
        userId: ticket.assignee.id,
        name: ticket.assignee.name,
        avatarColor: ticket.assignee.avatarColor,
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
        total: 0,
        overdue: 0,
      }
      rows.set(ticket.assignee.id, row)
    }

    row.total++

    switch (ticket.status.category) {
      case 'DONE':
        row.done++
        break
      case 'BLOCKED':
        row.blocked++
        break
      case 'IN_PROGRESS':
      case 'REVIEW':
        row.inProgress++
        break
      case 'CANCELLED':
        break
      default:
        row.open++
    }

    if (
      ticket.dueDate &&
      ticket.dueDate.getTime() < now &&
      ticket.status.category !== 'DONE' &&
      ticket.status.category !== 'CANCELLED'
    ) {
      row.overdue++
    }
  }

  return [...rows.values()].sort((a, b) => b.total - a.total)
}

/** Project health cards for the workspace dashboard. */
export async function getProjectSummaries(actor: Actor, limit = 6) {
  const projects = await prisma.project.findMany({
    where: { isArchived: false, ...projectVisibilityFilter(actor) },
    select: {
      id: true,
      name: true,
      code: true,
      endDate: true,
      settings: { select: { color: true, logoUrl: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  if (projects.length === 0) return []

  const projectIds = projects.map((project) => project.id)

  const [totals, completed, overdue] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, isArchived: false },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        isArchived: false,
        status: { category: 'DONE' },
      },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        isArchived: false,
        dueDate: { lt: new Date() },
        status: { category: { notIn: ['DONE', 'CANCELLED'] } },
      },
      _count: { _all: true },
    }),
  ])

  const totalBy = new Map(totals.map((row) => [row.projectId, row._count._all]))
  const doneBy = new Map(completed.map((row) => [row.projectId, row._count._all]))
  const overdueBy = new Map(overdue.map((row) => [row.projectId, row._count._all]))

  return projects.map((project) => {
    const total = totalBy.get(project.id) ?? 0
    const done = doneBy.get(project.id) ?? 0
    return {
      id: project.id,
      name: project.name,
      code: project.code,
      color: project.settings?.color ?? 'indigo',
      logoUrl: project.settings?.logoUrl ?? null,
      endDate: project.endDate,
      total,
      done,
      overdue: overdueBy.get(project.id) ?? 0,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    }
  })
}
