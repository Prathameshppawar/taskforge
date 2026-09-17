import type { RoleKey, ProjectMemberRole } from '@prisma/client'

/**
 * Permission model.
 *
 * Role ASSIGNMENT lives in the database (the `roles` table); the POLICY —
 * which role may do what — lives here as a typed matrix. One source of truth,
 * compile-time checked, and evaluated without a database round-trip.
 *
 * Authorization is two-layered:
 *   1. Global permission  — does this role have the capability at all?
 *   2. Project scope      — is the actor a member of the project in question,
 *                           and with sufficient project role?
 * Admins bypass layer 2 entirely.
 */
export const PERMISSIONS = [
  // Users & platform administration
  'user:create',
  'user:update',
  'user:deactivate',
  'user:reset-password',
  'user:view',
  'template:manage',
  'audit:view-all',

  // Projects
  'project:create',
  'project:update',
  'project:archive',
  'project:delete',
  'project:manage-members',
  'project:manage-config', // statuses, priorities, types
  'project:view',

  // Labels
  'label:create',
  'label:update',
  'label:delete',

  // Tickets
  'ticket:create',
  'ticket:update',
  'ticket:update-any',
  'ticket:delete',
  'ticket:assign',
  'ticket:transition',

  // Collaboration
  'comment:create',
  'comment:delete-any',

  // Automation & AI
  'recurring:manage',
  'ai:use',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const USER_PERMISSIONS: Permission[] = [
  'project:view',
  'ticket:create',
  'ticket:update',
  'ticket:transition',
  'comment:create',
  'ai:use',
]

const PROJECT_MANAGER_PERMISSIONS: Permission[] = [
  ...USER_PERMISSIONS,
  'user:view',
  'project:create',
  'project:update',
  'project:archive',
  'project:manage-members',
  'project:manage-config',
  'label:create',
  'label:update',
  'label:delete',
  'ticket:update-any',
  'ticket:delete',
  'ticket:assign',
  'comment:delete-any',
  'recurring:manage',
]

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS]

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  PROJECT_MANAGER: PROJECT_MANAGER_PERMISSIONS,
  USER: USER_PERMISSIONS,
}

export function roleHas(role: RoleKey, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/**
 * Permissions that additionally require the actor to be a project MANAGER
 * (or a global Admin) when applied inside a specific project.
 */
const PROJECT_MANAGER_SCOPED: ReadonlySet<Permission> = new Set<Permission>([
  'project:update',
  'project:archive',
  'project:manage-members',
  'project:manage-config',
  'label:create',
  'label:update',
  'label:delete',
  'recurring:manage',
])

/** Project roles that may modify tickets. VIEWER is read-only. */
const WRITE_CAPABLE_PROJECT_ROLES: ReadonlySet<ProjectMemberRole> = new Set<ProjectMemberRole>([
  'MANAGER',
  'MEMBER',
])

export interface ProjectAccessContext {
  role: RoleKey
  /** Null when the actor is not a member of the project. */
  memberRole: ProjectMemberRole | null
  isOwner: boolean
}

/** Evaluates a permission in the context of one project. */
export function canInProject(ctx: ProjectAccessContext, permission: Permission): boolean {
  if (ctx.role === 'ADMIN') return true
  if (!roleHas(ctx.role, permission)) return false

  // Not a member and not the owner -> no project-scoped capability at all.
  if (!ctx.memberRole && !ctx.isOwner) return false

  if (PROJECT_MANAGER_SCOPED.has(permission)) {
    return ctx.isOwner || ctx.memberRole === 'MANAGER'
  }

  // Write operations require a non-viewer membership.
  if (permission.includes(':create') || permission.includes(':update') ||
      permission.includes(':delete') || permission.includes(':transition') ||
      permission.includes(':assign')) {
    return ctx.isOwner || (ctx.memberRole != null && WRITE_CAPABLE_PROJECT_ROLES.has(ctx.memberRole))
  }

  return true
}

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Project Manager',
  USER: 'User',
}

export const PROJECT_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  MANAGER: 'Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
}
