import { cache } from 'react'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { ticketVisibilityFilter, type Actor } from '@/features/auth/guards'
import { rollupProgress } from '@/core/domain/ticket-rules'
import { EMPTY_FILTERS, type TicketFilters } from '@/features/filters/types'

/**
 * Read models for the ticket views.
 *
 * `buildTicketWhere` is the single place filters become SQL, so the table,
 * board, calendar, timeline, My Tickets and the AI search tool all behave
 * identically.
 */

export function buildTicketWhere(
  filters: TicketFilters,
  actor: Actor,
  scope?: { projectId?: string; searchIds?: string[] },
): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [ticketVisibilityFilter(actor)]

  if (scope?.searchIds) and.push({ id: { in: scope.searchIds } })

  if (scope?.projectId) {
    and.push({ projectId: scope.projectId })
  } else if (filters.projectIds.length > 0) {
    and.push({ projectId: { in: filters.projectIds } })
  }

  if (!filters.includeArchived) and.push({ isArchived: false })

  if (filters.assigneeIds.length > 0) {
    // "unassigned" is expressed as a sentinel so it can be combined with people.
    const hasUnassigned = filters.assigneeIds.includes('none')
    const userIds = filters.assigneeIds.filter((id) => id !== 'none')

    if (hasUnassigned && userIds.length > 0) {
      and.push({ OR: [{ assigneeId: null }, { assigneeId: { in: userIds } }] })
    } else if (hasUnassigned) {
      and.push({ assigneeId: null })
    } else {
      and.push({ assigneeId: { in: userIds } })
    }
  }

  if (filters.unassignedOnly) and.push({ assigneeId: null })
  if (filters.reporterIds.length > 0) and.push({ reporterId: { in: filters.reporterIds } })
  if (filters.statusIds.length > 0) and.push({ statusId: { in: filters.statusIds } })
  if (filters.statusCategories.length > 0) {
    and.push({ status: { category: { in: filters.statusCategories } } })
  }
  if (filters.priorityIds.length > 0) and.push({ priorityId: { in: filters.priorityIds } })
  if (filters.typeIds.length > 0) and.push({ typeId: { in: filters.typeIds } })

  // Every selected label must be present (AND semantics), which is what people
  // expect from "Frontend-1 + Security".
  for (const labelId of filters.labelIds) {
    and.push({ labels: { some: { labelId } } })
  }

  if (filters.parentId !== undefined && filters.parentId !== null) {
    and.push({ parentId: filters.parentId })
  }
  if (filters.parentsOnly) and.push({ parentId: null })

  /*
   * `search` is handled separately, by searchTicketIds() below — a tsvector
   * match cannot be expressed in a Prisma where clause, and ILIKE '%term%'
   * cannot use an index. buildTicketWhere therefore receives the already
   * resolved id set instead.
   */

  if (filters.dueFrom || filters.dueTo) {
    and.push({
      dueDate: {
        ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
        ...(filters.dueTo ? { lte: filters.dueTo } : {}),
      },
    })
  }

  if (filters.createdFrom || filters.createdTo) {
    and.push({
      createdAt: {
        ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
        ...(filters.createdTo ? { lte: filters.createdTo } : {}),
      },
    })
  }

  if (filters.overdueOnly) {
    and.push({
      dueDate: { lt: new Date() },
      status: { category: { notIn: ['DONE', 'CANCELLED'] } },
    })
  }

  return { AND: and }
}

function buildOrderBy(filters: TicketFilters): Prisma.TicketOrderByWithRelationInput[] {
  const dir = filters.sortDir

  switch (filters.sortBy) {
    case 'priority':
      // Within a priority, the nearest deadline leads; tickets with no due
      // date sort last rather than jumping to the top.
      return [
        { priority: { level: dir } },
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ]
    case 'status':
      return [{ status: { position: dir } }, { position: 'asc' }]
    case 'dueDate':
      // Tickets without a due date sort last regardless of direction.
      return [{ dueDate: { sort: dir, nulls: 'last' } }, { updatedAt: 'desc' }]
    case 'title':
      return [{ title: dir }]
    case 'key':
      return [{ number: dir }]
    case 'createdAt':
      return [{ createdAt: dir }]
    default:
      return [{ updatedAt: dir }]
  }
}

/** Columns every list view needs. Kept in one place so shapes stay consistent. */
const TICKET_LIST_SELECT = {
  id: true,
  key: true,
  number: true,
  title: true,
  dueDate: true,
  startDate: true,
  completedAt: true,
  position: true,
  isArchived: true,
  storyPoints: true,
  estimateHours: true,
  createdAt: true,
  updatedAt: true,
  parentId: true,
  project: { select: { id: true, name: true, code: true } },
  status: { select: { id: true, name: true, color: true, category: true, position: true } },
  priority: { select: { id: true, name: true, color: true, level: true } },
  type: { select: { id: true, name: true, color: true, icon: true } },
  assignee: { select: { id: true, name: true, username: true, avatarColor: true } },
  reporter: { select: { id: true, name: true, username: true, avatarColor: true } },
  parent: { select: { id: true, key: true, title: true } },
  labels: {
    select: { label: { select: { id: true, name: true, color: true } } },
  },
  _count: { select: { children: true, comments: true, resources: true } },
} satisfies Prisma.TicketSelect

type RawTicketListItem = Prisma.TicketGetPayload<{ select: typeof TICKET_LIST_SELECT }>

/**
 * A ticket as the UI receives it.
 *
 * `estimateHours` is a Postgres NUMERIC, which Prisma returns as a Decimal
 * instance. Decimal is a class, not a plain object, so React refuses to send it
 * across the Server → Client boundary. Converting here — at the single point
 * every view reads through — means no client component can ever be handed one,
 * rather than relying on each view to remember.
 *
 * NUMERIC(6,2) fits in a float without loss, so Number() is safe. A wider
 * precision column would need a string instead.
 */
export type TicketListItem = Omit<RawTicketListItem, 'estimateHours'> & {
  estimateHours: number | null
}

function toSerializable<T extends { estimateHours: Prisma.Decimal | null }>(
  ticket: T,
): Omit<T, 'estimateHours'> & { estimateHours: number | null } {
  return {
    ...ticket,
    estimateHours: ticket.estimateHours === null ? null : Number(ticket.estimateHours),
  }
}

/**
 * Resolves a free-text query to ranked ticket ids.
 *
 * Uses the GIN-indexed tsvector, with a trigram fallback on the human key so
 * "ATLAS-1" still matches — tsvector tokenises a key as a single lexeme and
 * cannot serve a partial one. Returns ids in relevance order; the caller
 * preserves that order when the user has not chosen an explicit sort.
 */
async function searchTicketIds(term: string, limit: number): Promise<string[]> {
  const query = term.trim()
  if (!query) return []

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM tickets
    WHERE "searchVector" @@ plainto_tsquery('english', ${query})
       OR "key" ILIKE ${'%' + query + '%'}
    ORDER BY
      -- An exact key match is never not the intended result.
      (CASE WHEN upper("key") = upper(${query}) THEN 1 ELSE 0 END) DESC,
      ts_rank("searchVector", plainto_tsquery('english', ${query})) DESC,
      "updatedAt" DESC
    LIMIT ${limit}
  `
  return rows.map((row) => row.id)
}

export async function listTickets(
  actor: Actor,
  filters: TicketFilters,
  options: { projectId?: string; take?: number; skip?: number } = {},
) {
  const take = options.take ?? 500

  // Resolve the text query first; an empty result short-circuits the rest.
  let searchIds: string[] | undefined
  if (filters.search?.trim()) {
    searchIds = await searchTicketIds(filters.search, Math.max(take, 200))
    if (searchIds.length === 0) return { items: [], total: 0 }
  }

  const where = buildTicketWhere(filters, actor, {
    projectId: options.projectId,
    searchIds,
  })

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      select: TICKET_LIST_SELECT,
      orderBy: buildOrderBy(filters),
      take,
      skip: options.skip ?? 0,
    }),
    prisma.ticket.count({ where }),
  ])

  let ordered = items
  // Relevance only survives if the user has not asked for a different order.
  if (searchIds && filters.sortBy === 'priority') {
    const rank = new Map(searchIds.map((id, index) => [id, index]))
    ordered = [...items].sort(
      (a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9),
    )
  }

  return { items: ordered.map(toSerializable), total }
}

/** Board data: the project's columns plus the tickets sitting in each. */
export async function getBoardData(
  actor: Actor,
  projectId: string,
  filters: TicketFilters,
) {
  const searchIds = filters.search?.trim()
    ? await searchTicketIds(filters.search, 1000)
    : undefined

  const [statuses, tickets] = await Promise.all([
    prisma.status.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, color: true, category: true, position: true },
    }),
    prisma.ticket.findMany({
      where: buildTicketWhere(filters, actor, { projectId, searchIds }),
      select: TICKET_LIST_SELECT,
      /*
       * Priority leads on the board too. `position` still orders tickets of
       * equal priority, so dragging to reorder within a priority works as
       * before — but a Blocker can no longer be dragged below a Low.
       */
      orderBy: [
        { priority: { level: 'desc' } },
        { position: 'asc' },
        { number: 'asc' },
      ],
      take: 1000,
    }),
  ])

  const byStatus = new Map<string, TicketListItem[]>()
  for (const status of statuses) byStatus.set(status.id, [])
  for (const ticket of tickets) {
    byStatus.get(ticket.status.id)?.push(toSerializable(ticket))
  }

  return {
    columns: statuses.map((status) => ({
      status,
      tickets: byStatus.get(status.id) ?? [],
    })),
  }
}

/** Full ticket detail, including thread, resources and history. */
export const getTicketByKey = cache(async (actor: Actor, key: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: {
      key: key.toUpperCase(),
      ...ticketVisibilityFilter(actor),
    },
    select: {
      ...TICKET_LIST_SELECT,
      description: true,
      remarks: true,
      children: {
        select: {
          id: true,
          key: true,
          title: true,
          dueDate: true,
          status: { select: { id: true, name: true, color: true, category: true } },
          priority: { select: { id: true, name: true, color: true, level: true } },
          type: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true, avatarColor: true } },
        },
        orderBy: [{ priority: { level: 'desc' } }, { number: 'asc' }],
      },
      resources: {
        select: {
          id: true,
          name: true,
          type: true,
          url: true,
          notes: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        select: {
          id: true,
          body: true,
          parentId: true,
          isEdited: true,
          editedAt: true,
          deletedAt: true,
          createdAt: true,
          author: { select: { id: true, name: true, username: true, avatarColor: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!ticket) return null

  const progress =
    ticket.children.length > 0
      ? rollupProgress(ticket.children.map((c) => ({ statusCategory: c.status.category })))
      : null

  return { ...toSerializable(ticket), progress }
})

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketByKey>>>

/** Parent tickets with their children, for the tree view. */
export async function getTicketTree(actor: Actor, projectId: string) {
  const tickets = await prisma.ticket.findMany({
    where: buildTicketWhere(EMPTY_FILTERS, actor, { projectId }),
    select: {
      id: true,
      key: true,
      title: true,
      parentId: true,
      dueDate: true,
      status: { select: { id: true, name: true, color: true, category: true } },
      priority: { select: { name: true, color: true, level: true } },
      type: { select: { name: true, color: true } },
      assignee: { select: { id: true, name: true, avatarColor: true } },
      labels: { select: { label: { select: { id: true, name: true, color: true } } } },
    },
    orderBy: [{ priority: { level: 'desc' } }, { number: 'asc' }],
  })

  const childrenByParent = new Map<string, typeof tickets>()
  const roots: typeof tickets = []

  for (const ticket of tickets) {
    if (ticket.parentId) {
      const bucket = childrenByParent.get(ticket.parentId) ?? []
      bucket.push(ticket)
      childrenByParent.set(ticket.parentId, bucket)
    } else {
      roots.push(ticket)
    }
  }

  return roots.map((root) => {
    const children = childrenByParent.get(root.id) ?? []
    return {
      ...root,
      children,
      progress: rollupProgress(
        children.map((c) => ({ statusCategory: c.status.category })),
      ),
    }
  })
}

/** Candidate parents for the parent picker: top-level tickets in the project. */
export async function listParentCandidates(projectId: string, excludeTicketId?: string) {
  return prisma.ticket.findMany({
    where: {
      projectId,
      parentId: null,
      isArchived: false,
      ...(excludeTicketId ? { id: { not: excludeTicketId } } : {}),
    },
    select: { id: true, key: true, title: true },
    orderBy: { number: 'desc' },
    take: 100,
  })
}

/**
 * Duplicate detection.
 *
 * Deliberately not an AI call — a trigram-style overlap on titles within the
 * same project is fast, deterministic and costs nothing. The Copilot surfaces
 * these before creating a ticket.
 */
export async function findSimilarTickets(
  projectId: string,
  title: string,
  limit = 5,
): Promise<Array<{ id: string; key: string; title: string; statusName: string; score: number }>> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)

  if (words.length === 0) return []

  const candidates = await prisma.ticket.findMany({
    where: {
      projectId,
      isArchived: false,
      OR: words.map((word) => ({ title: { contains: word, mode: 'insensitive' as const } })),
    },
    select: {
      id: true,
      key: true,
      title: true,
      status: { select: { name: true } },
    },
    take: 40,
  })

  const targetSet = new Set(words)

  return candidates
    .map((candidate) => {
      const candidateWords = new Set(
        candidate.title
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((word) => word.length > 2),
      )

      let overlap = 0
      for (const word of targetSet) if (candidateWords.has(word)) overlap++

      // Jaccard similarity over the two word sets.
      const union = new Set([...targetSet, ...candidateWords]).size
      const score = union === 0 ? 0 : overlap / union

      return {
        id: candidate.id,
        key: candidate.key,
        title: candidate.title,
        statusName: candidate.status.name,
        score,
      }
    })
    .filter((candidate) => candidate.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
