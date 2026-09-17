import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { RoleKey } from '@prisma/client'

import { auth } from '@/auth'
import { prisma } from '@/infrastructure/db/prisma'
import {
  canInProject,
  roleHas,
  type Permission,
  type ProjectAccessContext,
} from '@/core/domain/rbac'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/core/domain/errors'

export interface Actor {
  id: string
  username: string
  name: string
  role: RoleKey
  avatarColor: string
  mustChangePassword: boolean
}

/**
 * Current actor, or null when signed out.
 *
 * Wrapped in React's `cache` so multiple guards in one render pass share a
 * single session read rather than repeating it per component.
 */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const session = await auth()
  if (!session?.user?.id) return null

  return {
    id: session.user.id,
    username: session.user.username,
    name: session.user.name ?? session.user.username,
    role: session.user.role,
    avatarColor: session.user.avatarColor,
    mustChangePassword: session.user.mustChangePassword,
  }
})

/**
 * For pages: redirects to /login when signed out.
 * Server Actions should use `requireActor` instead, which throws a typed error.
 */
export async function requireUser(): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

/** For Server Actions — throws rather than redirecting. */
export async function requireActor(): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

/** Asserts a global (non project-scoped) permission. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await requireActor()
  if (!roleHas(actor.role, permission)) {
    throw new ForbiddenError(`Your role does not allow this action (${permission}).`)
  }
  return actor
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await requireActor()
  if (actor.role !== 'ADMIN') {
    throw new ForbiddenError('This area is restricted to administrators.')
  }
  return actor
}

/**
 * Resolves the actor's standing within one project: their membership role and
 * whether they own it. Cached per request.
 */
export const getProjectAccess = cache(
  async (projectId: string, actor: Actor): Promise<ProjectAccessContext> => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerId: true,
        members: {
          where: { userId: actor.id },
          select: { role: true },
          take: 1,
        },
      },
    })

    if (!project) throw new NotFoundError('Project', projectId)

    return {
      role: actor.role,
      memberRole: project.members[0]?.role ?? null,
      isOwner: project.ownerId === actor.id,
    }
  },
)

export interface ProjectGuardResult {
  actor: Actor
  access: ProjectAccessContext
}

/** Asserts a permission within the scope of a specific project. */
export async function requireProjectPermission(
  projectId: string,
  permission: Permission,
): Promise<ProjectGuardResult> {
  const actor = await requireActor()
  const access = await getProjectAccess(projectId, actor)

  if (!canInProject(access, permission)) {
    throw new ForbiddenError('You do not have permission to do that in this project.')
  }

  return { actor, access }
}

/**
 * Read access to a project. Admins and Project Managers may browse every
 * project; regular users see projects they belong to or own, unless the project
 * is marked private — in which case membership is required of everyone but an
 * admin.
 */
export async function requireProjectView(projectId: string): Promise<ProjectGuardResult> {
  const actor = await requireActor()
  const access = await getProjectAccess(projectId, actor)

  if (actor.role === 'ADMIN') return { actor, access }

  const settings = await prisma.projectSettings.findUnique({
    where: { projectId },
    select: { isPrivate: true },
  })

  const isMember = access.memberRole !== null || access.isOwner

  if (settings?.isPrivate && !isMember) {
    throw new ForbiddenError('This project is private.')
  }

  if (!isMember && actor.role === 'USER') {
    throw new ForbiddenError('You are not a member of this project.')
  }

  return { actor, access }
}

/**
 * Prisma `where` fragment restricting a ticket/project query to what the actor
 * may see. Admins and PMs are unrestricted; users are limited to projects they
 * belong to or own.
 */
export function projectVisibilityFilter(actor: Actor) {
  if (actor.role === 'ADMIN' || actor.role === 'PROJECT_MANAGER') return {}

  return {
    OR: [
      { ownerId: actor.id },
      { members: { some: { userId: actor.id } } },
    ],
  }
}

export function ticketVisibilityFilter(actor: Actor) {
  if (actor.role === 'ADMIN' || actor.role === 'PROJECT_MANAGER') return {}

  return {
    project: {
      OR: [
        { ownerId: actor.id },
        { members: { some: { userId: actor.id } } },
      ],
    },
  }
}
