import { prisma } from '@/infrastructure/db/prisma'
import { projectVisibilityFilter, type Actor } from '@/features/auth/guards'
import { NotFoundError } from '@/core/domain/errors'

/**
 * Name → id resolution for the Copilot.
 *
 * The model speaks in human terms ("High", "Backend-1", "assign to Arjun"), but
 * every action takes ids. Resolution is scoped to what the actor can actually
 * see, so a hallucinated project code cannot reach another team's data.
 *
 * Matching is deliberately forgiving (case-insensitive, then prefix) because
 * models rarely reproduce casing exactly — but it never guesses across
 * entities, and an unresolved name becomes a clear error the model can act on.
 */

export async function resolveProject(actor: Actor, code?: string, fallbackId?: string) {
  if (code) {
    const project = await prisma.project.findFirst({
      where: {
        code: { equals: code.toUpperCase(), mode: 'insensitive' },
        ...projectVisibilityFilter(actor),
      },
      select: { id: true, code: true, name: true, isArchived: true },
    })

    if (project) return project

    // Fall back to a name match — users say "the Atlas project" as often as a code.
    const byName = await prisma.project.findFirst({
      where: {
        name: { contains: code, mode: 'insensitive' },
        ...projectVisibilityFilter(actor),
      },
      select: { id: true, code: true, name: true, isArchived: true },
    })

    if (byName) return byName

    throw new NotFoundError('Project', code)
  }

  if (fallbackId) {
    const project = await prisma.project.findFirst({
      where: { id: fallbackId, ...projectVisibilityFilter(actor) },
      select: { id: true, code: true, name: true, isArchived: true },
    })
    if (project) return project
  }

  throw new NotFoundError(
    'Project',
    'no project was specified and none is currently open',
  )
}

interface NamedRow {
  id: string
  name: string
}

/** Case-insensitive exact match, then prefix, then substring. */
function matchByName<T extends NamedRow>(rows: T[], needle: string): T | null {
  const target = needle.trim().toLowerCase()
  if (!target) return null

  return (
    rows.find((row) => row.name.toLowerCase() === target) ??
    rows.find((row) => row.name.toLowerCase().startsWith(target)) ??
    rows.find((row) => row.name.toLowerCase().includes(target)) ??
    null
  )
}

export async function resolveStatus(projectId: string, name?: string) {
  if (!name) return null
  const rows = await prisma.status.findMany({
    where: { projectId },
    select: { id: true, name: true, category: true },
  })
  return matchByName(rows, name)
}

export async function resolvePriority(projectId: string, name?: string) {
  if (!name) return null
  const rows = await prisma.priority.findMany({
    where: { projectId },
    select: { id: true, name: true },
  })
  return matchByName(rows, name)
}

export async function resolveType(projectId: string, name?: string) {
  if (!name) return null
  const rows = await prisma.ticketType.findMany({
    where: { projectId },
    select: { id: true, name: true },
  })
  return matchByName(rows, name)
}

export async function resolveLabels(projectId: string, names?: string[]) {
  if (!names?.length) return []
  const rows = await prisma.label.findMany({
    where: { projectId },
    select: { id: true, name: true },
  })

  const resolved: Array<{ id: string; name: string }> = []
  for (const name of names) {
    const match = matchByName(rows, name)
    if (match) resolved.push(match)
  }
  return resolved
}

/**
 * Resolves a person. Accepts "me", a username or a full name, and is limited to
 * members of the project so the Copilot cannot assign work to an outsider.
 */
export async function resolveUser(
  actor: Actor,
  projectId: string,
  needle?: string,
): Promise<{ id: string; name: string } | null> {
  if (!needle) return null

  const trimmed = needle.trim().toLowerCase()
  if (trimmed === 'none' || trimmed === 'nobody' || trimmed === 'unassigned') {
    return null
  }
  if (trimmed === 'me' || trimmed === 'myself' || trimmed === 'i') {
    return { id: actor.id, name: actor.name }
  }

  const members = await prisma.projectMember.findMany({
    where: { projectId, user: { isActive: true } },
    select: { user: { select: { id: true, name: true, username: true } } },
  })

  const users = members.map((member) => member.user)

  const byUsername = users.find((user) => user.username.toLowerCase() === trimmed)
  if (byUsername) return { id: byUsername.id, name: byUsername.name }

  const byName = matchByName(users, needle)
  return byName ? { id: byName.id, name: byName.name } : null
}

export async function resolveTicketByKey(actor: Actor, key: string) {
  const ticket = await prisma.ticket.findFirst({
    where: {
      key: key.trim().toUpperCase(),
      project: projectVisibilityFilter(actor),
    },
    select: {
      id: true,
      key: true,
      title: true,
      projectId: true,
      project: { select: { code: true, name: true } },
    },
  })

  if (!ticket) throw new NotFoundError('Ticket', key)
  return ticket
}

export function daysFromNow(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(17, 0, 0, 0)
  return date
}
