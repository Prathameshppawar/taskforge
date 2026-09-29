import { prisma } from '@/infrastructure/db/prisma'
import { projectVisibilityFilter, type Actor } from '@/features/auth/guards'

/**
 * What a client sees: for each project they belong to, what they asked for,
 * what is waiting on them, and what has shipped — with the links to open it.
 * Built on the same visibility filter as the rest of the app, so the portal
 * can never show a client a project they could not otherwise see.
 */
export async function getPortal(actor: Actor) {
  const projects = await prisma.project.findMany({
    where: { isArchived: false, ...projectVisibilityFilter(actor) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true, settings: { select: { color: true } } },
  })
  const since = new Date(Date.now() - 30 * 86_400_000)

  return Promise.all(
    projects.map(async (project) => {
      const [requests, awaiting, shipped] = await Promise.all([
        prisma.ticket.findMany({
          where: { projectId: project.id, reporterId: actor.id, isArchived: false },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: { key: true, title: true, updatedAt: true, status: { select: { name: true, category: true } } },
        }),
        prisma.ticket.findMany({
          where: { projectId: project.id, isArchived: false, status: { category: 'REVIEW' } },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: {
            key: true,
            title: true,
            status: { select: { name: true } },
            deployments: {
              where: { deployment: { isProduction: false, state: 'SUCCESS', url: { not: null } } },
              orderBy: { deployment: { createdAt: 'desc' } },
              take: 1,
              select: { deployment: { select: { url: true, environment: true } } },
            },
          },
        }),
        prisma.ticketDeployment.findMany({
          where: {
            ticket: { projectId: project.id },
            deployment: { isProduction: true, state: 'SUCCESS', createdAt: { gte: since } },
          },
          orderBy: { deployment: { createdAt: 'desc' } },
          take: 20,
          select: {
            ticket: { select: { key: true, title: true } },
            deployment: { select: { createdAt: true, url: true, environment: true } },
          },
        }),
      ])
      return { project, requests, awaiting, shipped }
    }),
  )
}

export type Portal = Awaited<ReturnType<typeof getPortal>>
