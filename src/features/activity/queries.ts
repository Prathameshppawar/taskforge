import { prisma } from '@/infrastructure/db/prisma'
import { projectVisibilityFilter, type Actor } from '@/features/auth/guards'

const ACTIVITY_SELECT = {
  id: true,
  action: true,
  entityLabel: true,
  field: true,
  oldValue: true,
  newValue: true,
  summary: true,
  createdAt: true,
  actor: { select: { id: true, name: true, avatarColor: true } },
  ticket: { select: { key: true, title: true } },
} as const

export async function getTicketActivity(ticketId: string, take = 50) {
  return prisma.activityLog.findMany({
    where: { ticketId },
    select: ACTIVITY_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}

export async function getProjectActivity(projectId: string, take = 100) {
  return prisma.activityLog.findMany({
    where: { projectId },
    select: ACTIVITY_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}

/** Cross-project feed, limited to what the actor can see. */
export async function getWorkspaceActivity(actor: Actor, take = 100) {
  return prisma.activityLog.findMany({
    where:
      actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { project: projectVisibilityFilter(actor) },
              // Platform-level events (user management) have no project scope.
              { projectId: null, actorId: actor.id },
            ],
          },
    select: ACTIVITY_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}
