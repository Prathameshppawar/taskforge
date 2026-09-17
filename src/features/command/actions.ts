'use server'

import { prisma } from '@/infrastructure/db/prisma'
import {
  projectVisibilityFilter,
  requireActor,
  ticketVisibilityFilter,
} from '@/features/auth/guards'
import { parseTicketKey } from '@/core/domain/ticket-rules'
import { ok, type ActionResult } from '@/core/domain/result'
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
