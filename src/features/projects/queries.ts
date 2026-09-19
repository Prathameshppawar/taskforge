import { cache } from 'react'

import { prisma } from '@/infrastructure/db/prisma'
import { projectVisibilityFilter, type Actor } from '@/features/auth/guards'

/** Lightweight project list for the sidebar. Cached per request. */
export const getSidebarProjects = cache(async (actor: Actor) => {
  const projects = await prisma.project.findMany({
    where: {
      isArchived: false,
      ...projectVisibilityFilter(actor),
    },
    select: {
      id: true,
      name: true,
      code: true,
      settings: { select: { color: true, logoUrl: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 30,
  })

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    color: project.settings?.color ?? 'indigo',
    logoUrl: project.settings?.logoUrl ?? null,
  }))
})

/** Full project list for the projects index. */
export async function listProjects(
  actor: Actor,
  options: { includeArchived?: boolean; search?: string } = {},
) {
  const { includeArchived = false, search } = options

  return prisma.project.findMany({
    where: {
      ...(includeArchived ? {} : { isArchived: false }),
      ...projectVisibilityFilter(actor),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { code: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      isArchived: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, avatarColor: true } },
      settings: { select: { color: true, icon: true, logoUrl: true } },
      _count: { select: { tickets: true, members: true } },
    },
    orderBy: [{ isArchived: 'asc' }, { updatedAt: 'desc' }],
  })
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjects>>[number]

/** Full project context used by every view under /projects/[projectId]. */
export const getProjectDetail = cache(async (projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      isArchived: true,
      archivedAt: true,
      createdAt: true,
      owner: { select: { id: true, name: true, username: true, avatarColor: true } },
      template: { select: { id: true, name: true } },
      settings: true,
      members: {
        select: {
          role: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              avatarColor: true,
              jobTitle: true,
              isActive: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
      // Attached teams, with the people they bring. Everyone here has access to
      // the project even without a ProjectMember row of their own.
      teams: {
        select: {
          role: true,
          createdAt: true,
          team: {
            select: {
              id: true,
              name: true,
              description: true,
              members: {
                select: {
                  isManager: true,
                  user: {
                    select: {
                      id: true,
                      name: true,
                      username: true,
                      avatarColor: true,
                      jobTitle: true,
                      isActive: true,
                    },
                  },
                },
                orderBy: [{ isManager: 'desc' }, { user: { name: 'asc' } }],
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      statuses: {
        select: {
          id: true,
          name: true,
          color: true,
          category: true,
          position: true,
          isInitial: true,
          _count: { select: { tickets: true } },
        },
        orderBy: { position: 'asc' },
      },
      priorities: {
        select: {
          id: true,
          name: true,
          color: true,
          level: true,
          isDefault: true,
          _count: { select: { tickets: true } },
        },
        orderBy: { level: 'desc' },
      },
      ticketTypes: {
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
          position: true,
          isDefault: true,
          _count: { select: { tickets: true } },
        },
        orderBy: { position: 'asc' },
      },
      labels: {
        select: {
          id: true,
          name: true,
          color: true,
          description: true,
          _count: { select: { tickets: true } },
        },
        orderBy: { name: 'asc' },
      },
      _count: { select: { tickets: true } },
    },
  })

  return project
})

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>

/** Projects the actor can import labels from (everything except the target). */
export async function listImportSourceProjects(actor: Actor, excludeProjectId: string) {
  return prisma.project.findMany({
    where: {
      id: { not: excludeProjectId },
      ...projectVisibilityFilter(actor),
      labels: { some: {} },
    },
    select: {
      id: true,
      name: true,
      code: true,
      _count: { select: { labels: true } },
    },
    orderBy: { name: 'asc' },
  })
}
