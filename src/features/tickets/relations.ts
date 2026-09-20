import type { TicketLinkType } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'

/**
 * Ticket links and watchers.
 *
 * A link is stored once, from source to target. The reverse reading is derived
 * when displaying rather than written as a second row: two rows could disagree,
 * could be half-deleted, and would double every write. Everything about how a
 * link *reads* therefore lives in the pure helpers below, which is also what
 * makes them assertable without a database.
 */

export type LinkDirection = 'outgoing' | 'incoming'

/** How a link reads from one end of it. */
export function describeLink(type: TicketLinkType, direction: LinkDirection): string {
  switch (type) {
    case 'BLOCKS':
      return direction === 'outgoing' ? 'blocks' : 'is blocked by'
    case 'DUPLICATES':
      return direction === 'outgoing' ? 'duplicates' : 'is duplicated by'
    case 'RELATES_TO':
      // Symmetric: it reads the same from either end, which is precisely why
      // only one row exists.
      return 'relates to'
  }
}

/** Groups that need attention when they are unresolved. */
export function isBlocking(type: TicketLinkType, direction: LinkDirection): boolean {
  return type === 'BLOCKS' && direction === 'incoming'
}

export type LinkRejection =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Whether a proposed link is allowed, given the links that already exist.
 *
 * Pure, and deliberately strict about two cases the database cannot express:
 * a ticket linking to itself, and a pair of BLOCKS links pointing both ways —
 * which reads as "each waits for the other" and is never what anybody means.
 */
export function validateLink(
  sourceId: string,
  targetId: string,
  type: TicketLinkType,
  existing: Array<{ sourceId: string; targetId: string; type: TicketLinkType }>,
): LinkRejection {
  if (sourceId === targetId) {
    return { ok: false, reason: 'A ticket cannot be linked to itself.' }
  }

  const duplicate = existing.some(
    (link) => link.sourceId === sourceId && link.targetId === targetId && link.type === type,
  )
  if (duplicate) return { ok: false, reason: 'That link already exists.' }

  // A symmetric link in the other direction is the same link.
  if (type === 'RELATES_TO') {
    const mirrored = existing.some(
      (link) =>
        link.type === 'RELATES_TO' && link.sourceId === targetId && link.targetId === sourceId,
    )
    if (mirrored) return { ok: false, reason: 'These tickets are already related.' }
  }

  if (type === 'BLOCKS') {
    const reciprocal = existing.some(
      (link) => link.type === 'BLOCKS' && link.sourceId === targetId && link.targetId === sourceId,
    )
    if (reciprocal) {
      return {
        ok: false,
        reason: 'Those tickets would block each other, so neither could ever start.',
      }
    }
  }

  return { ok: true }
}

export interface LinkedTicket {
  linkId: string
  type: TicketLinkType
  direction: LinkDirection
  relation: string
  /** True when this link is something standing in the way of the ticket. */
  blocking: boolean
  key: string
  title: string
  statusName: string
  statusCategory: string
  isResolved: boolean
}

const RESOLVED = new Set(['DONE', 'CANCELLED'])

/** Every link on a ticket, from both ends, already phrased for display. */
export async function listTicketLinks(ticketId: string): Promise<LinkedTicket[]> {
  const select = {
    id: true,
    type: true,
    source: {
      select: { key: true, title: true, status: { select: { name: true, category: true } } },
    },
    target: {
      select: { key: true, title: true, status: { select: { name: true, category: true } } },
    },
  } as const

  const [outgoing, incoming] = await Promise.all([
    prisma.ticketLink.findMany({ where: { sourceId: ticketId }, select, orderBy: { createdAt: 'asc' } }),
    prisma.ticketLink.findMany({ where: { targetId: ticketId }, select, orderBy: { createdAt: 'asc' } }),
  ])

  const shape = (
    link: (typeof outgoing)[number],
    direction: LinkDirection,
  ): LinkedTicket => {
    const other = direction === 'outgoing' ? link.target : link.source
    return {
      linkId: link.id,
      type: link.type,
      direction,
      relation: describeLink(link.type, direction),
      blocking: isBlocking(link.type, direction) && !RESOLVED.has(other.status.category),
      key: other.key,
      title: other.title,
      statusName: other.status.name,
      statusCategory: other.status.category,
      isResolved: RESOLVED.has(other.status.category),
    }
  }

  return [
    ...outgoing.map((link) => shape(link, 'outgoing')),
    ...incoming.map((link) => shape(link, 'incoming')),
  ]
}

/**
 * Everyone who should hear about activity on a ticket.
 *
 * Watchers, plus the assignee and reporter — who are watching in every sense
 * that matters without having pressed a button. `notify` removes the actor and
 * de-duplicates, so the overlap costs nothing.
 */
export async function ticketAudience(ticketId: string): Promise<string[]> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      assigneeId: true,
      reporterId: true,
      watchers: { select: { userId: true } },
    },
  })
  if (!ticket) return []

  return [
    ...ticket.watchers.map((watcher) => watcher.userId),
    ticket.assigneeId,
    ticket.reporterId,
  ].filter((id): id is string => Boolean(id))
}
