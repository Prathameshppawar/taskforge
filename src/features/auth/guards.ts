import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { prisma } from '@/infrastructure/db/prisma'
import {
  canInProject,
  hasPermission,
  isPermission,
  strongestProjectRole,
  type Permission,
  type ProjectAccessContext,
} from '@/core/domain/rbac'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/core/domain/errors'

export interface Actor {
  id: string
  username: string
  name: string
  /** Stable role identifier. Free-form — administrators define their own roles. */
  roleKey: string
  /** Display name of the role, for the UI. */
  roleName: string
  /**
   * Authority ranking, lower being more senior. Carried on the actor so a
   * seniority check never needs another query.
   */
  level: number
  /** Resolved capabilities. The single thing every authorization check reads. */
  permissions: Permission[]
  avatarColor: string
  mustChangePassword: boolean
}

/**
 * Resolves a role key to its rank and permission set.
 *
 * Read per request rather than carried in the session token, so that editing a
 * role takes effect on the user's very next request. Baking permissions into
 * the JWT would leave them stale until it refreshed, which for a *revoked*
 * permission means a window where it still works.
 *
 * `cache` keeps it to one query per request even though many guards ask.
 */
const resolveRole = cache(
  async (
    roleKey: string,
  ): Promise<{ name: string; level: number; permissions: Permission[] }> => {
    const role = await prisma.role.findUnique({
      where: { key: roleKey },
      select: {
        name: true,
        level: true,
        permissions: { select: { permission: true } },
      },
    })

    // Fail closed. A missing role means no capabilities and the lowest possible
    // rank, never a default that happens to permit something.
    if (!role) {
      return { name: 'Unknown role', level: Number.MAX_SAFE_INTEGER, permissions: [] }
    }

    return {
      name: role.name,
      level: role.level,
      // Rows are filtered against the compile-time catalogue: a permission left
      // behind by a rename no longer means anything and must not be honoured.
      permissions: role.permissions
        .map((row) => row.permission)
        .filter((value): value is Permission => isPermission(value)),
    }
  },
)

/**
 * Current actor, or null when unauthenticated.
 *
 * Resolves a browser session first, then falls back to an `Authorization:
 * Bearer` personal access token. Putting the fallback *here* rather than in
 * each caller is what makes the entire Server Action surface usable by
 * non-browser clients — the MCP server, scripts, CI — with no other change.
 * Every guard, permission check and audit entry downstream is identical
 * regardless of how the actor was identified, so a token can never take a path
 * a browser session could not.
 *
 * Wrapped in React's `cache` so multiple guards in one pass share one read.
 */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const session = await auth()

  if (session?.user?.id) {
    const role = await resolveRole(session.user.role)
    return {
      id: session.user.id,
      username: session.user.username,
      name: session.user.name ?? session.user.username,
      roleKey: session.user.role,
      roleName: role.name,
      level: role.level,
      permissions: role.permissions,
      avatarColor: session.user.avatarColor,
      mustChangePassword: session.user.mustChangePassword,
    }
  }

  // Token auth is header-based, so it is not subject to CSRF the way a cookie
  // would be. Reading headers can throw outside a request scope (e.g. during
  // static analysis at build time); treat that as "no actor".
  try {
    const { headers } = await import('next/headers')
    const headerList = await headers()
    const { authenticateToken } = await import('@/features/tokens/service')
    return await authenticateToken(headerList.get('authorization'))
  } catch {
    return null
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
  if (!hasPermission(actor.permissions, permission)) {
    throw new ForbiddenError(`Your role does not allow this action (${permission}).`)
  }
  return actor
}

/** Convenience predicate for branching in a page or component. */
export function can(actor: Actor, permission: Permission): boolean {
  return hasPermission(actor.permissions, permission)
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
        // Access also arrives through any team attached to this project that the
        // actor belongs to. Resolved here rather than at each call site, so
        // nothing downstream has to know membership has two shapes.
        teams: {
          where: { team: { members: { some: { userId: actor.id } } } },
          select: { role: true },
        },
      },
    })

    if (!project) throw new NotFoundError('Project', projectId)

    return {
      permissions: actor.permissions,
      memberRole: strongestProjectRole([
        ...project.members.map((member) => member.role),
        ...project.teams.map((team) => team.role),
      ]),
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
 * Read access to a project.
 *
 * `project:access-all` sees everything, private projects included. Otherwise a
 * private project requires membership of anyone, and a non-member needs
 * `project:view-all` to browse a project they do not belong to.
 */
export async function requireProjectView(projectId: string): Promise<ProjectGuardResult> {
  const actor = await requireActor()
  const access = await getProjectAccess(projectId, actor)

  if (hasPermission(actor.permissions, 'project:access-all')) return { actor, access }

  const settings = await prisma.projectSettings.findUnique({
    where: { projectId },
    select: { isPrivate: true },
  })

  const isMember = access.memberRole !== null || access.isOwner

  if (settings?.isPrivate && !isMember) {
    throw new ForbiddenError('This project is private.')
  }

  if (!isMember && !hasPermission(actor.permissions, 'project:view-all')) {
    throw new ForbiddenError('You are not a member of this project.')
  }

  return { actor, access }
}

/**
 * Prisma `where` fragment restricting a ticket/project query to what the actor
 * may see. `project:view-all` lifts the restriction; everyone else is limited
 * to projects they belong to or own.
 */
export function projectVisibilityFilter(actor: Actor) {
  if (hasPermission(actor.permissions, 'project:view-all')) return {}

  return {
    OR: [
      { ownerId: actor.id },
      { members: { some: { userId: actor.id } } },
      { teams: { some: { team: { members: { some: { userId: actor.id } } } } } },
    ],
  }
}

export function ticketVisibilityFilter(actor: Actor) {
  if (hasPermission(actor.permissions, 'project:view-all')) return {}

  return {
    project: {
      OR: [
        { ownerId: actor.id },
        { members: { some: { userId: actor.id } } },
        { teams: { some: { team: { members: { some: { userId: actor.id } } } } } },
      ],
    },
  }
}

// -----------------------------------------------------------------------------
// Page-level guards
//
// Server Actions THROW on an authorization failure, because runAction turns the
// throw into a typed ActionResult the form can render. Pages must not do that —
// an uncaught ForbiddenError renders a 500, which is the wrong answer to "you
// are not allowed here". These variants redirect to a proper explanation page
// instead. They must never be used inside an action: redirect() throws a
// control-flow signal that would escape as an unhandled error.
// -----------------------------------------------------------------------------

/** Permission-gated page guard. */
export async function requirePermissionPage(permission: Permission): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!hasPermission(user.permissions, permission)) redirect('/forbidden?reason=permission')
  return user
}

/** Project-scoped page guard: redirects rather than throwing. */
export async function requireProjectViewPage(projectId: string): Promise<ProjectGuardResult> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  try {
    return await requireProjectView(projectId)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    redirect('/forbidden?reason=project')
  }
}
