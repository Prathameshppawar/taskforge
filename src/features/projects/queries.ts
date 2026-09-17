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
      settings: { select: { color: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 30,
  })

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    color: project.settings?.color ?? 'indigo',
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
      settings: { select: { color: true, icon: true } },
      _count: { select: { tickets: true, members: true } },
    },
    orderBy: [{ isArchived: 'asc' }, { updatedAt: 'desc' }],
  })
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjects>>[number]
