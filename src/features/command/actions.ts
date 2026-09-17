'use server'

import { prisma } from '@/infrastructure/db/prisma'
import {
  getProjectAccess,
  projectVisibilityFilter,
  requireActor,
  ticketVisibilityFilter,
} from '@/features/auth/guards'
import { canInProject } from '@/core/domain/rbac'
import { parseTicketKey } from '@/core/domain/ticket-rules'
import { ok, type ActionResult } from '@/core/domain/result'
import { NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'

export interface PaletteTicket {
  id: string
  key: string
  title: string
  statusName: string
  statusColor: string
  projectCode: string
  projectId: string
}

export interface PaletteProject {
  id: string
  name: string
  code: string
  color: string
}

export interface PaletteResults {
  tickets: PaletteTicket[]
  projects: PaletteProject[]
}

/**
 * Command palette search.
 *
 * An exact ticket key is checked first and pinned to the top — typing "ATLAS-14"
 * should jump straight there rather than ranking it against fuzzy title matches.
 */
export async function paletteSearchAction(
  query: string,
): Promise<ActionResult<PaletteResults>> {
  return runAction(async () => {
    const actor = await requireActor()
    const term = query.trim()

    if (term.length < 1) {
      // Empty query: offer recent work rather than nothing.
      const [tickets, projects] = await Promise.all([
        prisma.ticket.findMany({
          where: { isArchived: false, ...ticketVisibilityFilter(actor) },
          select: TICKET_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
        prisma.project.findMany({
          where: { isArchived: false, ...projectVisibilityFilter(actor) },
          select: PROJECT_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
      ])

      return ok({ tickets: tickets.map(toTicket), projects: projects.map(toProject) })
    }

    const parsedKey = parseTicketKey(term)

    const [exact, matches, projects] = await Promise.all([
      parsedKey
        ? prisma.ticket.findFirst({
            where: { key: `${parsedKey.code}-${parsedKey.number}`, ...ticketVisibilityFilter(actor) },
            select: TICKET_SELECT,
          })
        : Promise.resolve(null),
      prisma.ticket.findMany({
        where: {
          isArchived: false,
          ...ticketVisibilityFilter(actor),
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { key: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: TICKET_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
      prisma.project.findMany({
        where: {
          ...projectVisibilityFilter(actor),
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: PROJECT_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
    ])

    const tickets = exact
      ? [exact, ...matches.filter((ticket) => ticket.id !== exact.id)]
      : matches

    return ok({
      tickets: tickets.slice(0, 12).map(toTicket),
      projects: projects.map(toProject),
    })
  })
}

const TICKET_SELECT = {
  id: true,
  key: true,
  title: true,
  status: { select: { name: true, color: true } },
  project: { select: { id: true, code: true } },
} as const

const PROJECT_SELECT = {
  id: true,
  name: true,
  code: true,
  settings: { select: { color: true } },
} as const

function toTicket(ticket: {
  id: string
  key: string
  title: string
  status: { name: string; color: string }
  project: { id: string; code: string }
}): PaletteTicket {
  return {
    id: ticket.id,
    key: ticket.key,
    title: ticket.title,
    statusName: ticket.status.name,
    statusColor: ticket.status.color,
    projectCode: ticket.project.code,
    projectId: ticket.project.id,
  }
}

function toProject(project: {
  id: string
  name: string
  code: string
  settings: { color: string } | null
}): PaletteProject {
  return {
    id: project.id,
    name: project.name,
    code: project.code,
    color: project.settings?.color ?? 'indigo',
  }
}

export interface TicketQuickActions {
  ticket: { id: string; key: string; title: string; projectId: string }
  statuses: Array<{ id: string; name: string; color: string; isCurrent: boolean }>
  members: Array<{ id: string; name: string; username: string; avatarColor: string; isCurrent: boolean }>
  canEdit: boolean
}

/**
 * Options for the palette's ticket action sub-view.
 *
 * Loaded on demand rather than shipped with every search result — statuses and
 * members are project-scoped, and a search can span projects.
 */
export async function getTicketQuickActionsAction(
  ticketId: string,
): Promise<ActionResult<TicketQuickActions>> {
  return runAction(async () => {
    const actor = await requireActor()

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, ...ticketVisibilityFilter(actor) },
      select: {
        id: true,
        key: true,
        title: true,
        projectId: true,
        statusId: true,
        assigneeId: true,
      },
    })
    if (!ticket) throw new NotFoundError('Ticket', ticketId)

    const access = await getProjectAccess(ticket.projectId, actor)
    const canEdit = canInProject(access, 'ticket:update')

    const [statuses, members] = await Promise.all([
      prisma.status.findMany({
        where: { projectId: ticket.projectId },
        select: { id: true, name: true, color: true },
        orderBy: { position: 'asc' },
      }),
      prisma.projectMember.findMany({
        where: { projectId: ticket.projectId, user: { isActive: true } },
        select: {
          user: { select: { id: true, name: true, username: true, avatarColor: true } },
        },
        orderBy: { user: { name: 'asc' } },
      }),
    ])

    return ok({
      ticket: {
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
        projectId: ticket.projectId,
      },
      statuses: statuses.map((status) => ({
        ...status,
        isCurrent: status.id === ticket.statusId,
      })),
      members: members.map((member) => ({
        ...member.user,
        isCurrent: member.user.id === ticket.assigneeId,
      })),
      canEdit,
    })
  })
}
