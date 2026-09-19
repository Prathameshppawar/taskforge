import type { ProjectMemberRole } from '@prisma/client'

/**
 * Permission model.
 *
 * The CATALOGUE below is code; the MAPPING from role to permission is data.
 *
 * That split is deliberate. Keeping the catalogue in TypeScript means a
 * permission string that nothing enforces cannot be referenced — the compiler
 * rejects it — and an administrator cannot invent a capability that no code
 * checks, which would read as a security control while doing nothing. Keeping
 * the mapping in the database is what lets an administrator define roles
 * without a deployment.
 *
 * Authorization is three-layered:
 *   1. Capability  — does the actor's role hold the permission at all?
 *   2. Scope       — is the actor inside the project in question, and with
 *                    sufficient project role? (`project:access-all` waives this.)
 *   3. Seniority   — for actions *on other people*, is the target ranked below
 *                    the actor? (see `outranks`)
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

  // Roles & teams
  'role:manage',
  'team:manage',
  /** Administer the members of a team you manage, within your level ceiling. */
  'team:manage-members',

  // Projects
  'project:create',
  'project:update',
  'project:archive',
  'project:delete',
  'project:manage-members',
  'project:manage-config', // statuses, priorities, types
  'project:view',
  /**
   * Sees every project in listings and search, without being a member. Purely
   * about visibility — it grants no ability to change anything.
   */
  'project:view-all',
  /**
   * Waives project membership for capabilities the role already holds — what
   * used to be the hardcoded Admin bypass, now an ordinary permission so a
   * custom role can be given it deliberately. Distinct from `project:view-all`
   * because seeing every project and being able to act in every project are
   * very different grants, and a Project Manager should have only the first.
   */
  'project:access-all',

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

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

/** Narrows an arbitrary string — a database row, a form field — to a Permission. */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value)
}

/**
 * How the permissions are presented when editing a role.
 *
 * Grouping is not decoration: a flat list of 33 checkboxes invites someone to
 * tick one without noticing what else it implies. The notes call out the few
 * that grant more than their name suggests.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{
  label: string
  description: string
  permissions: ReadonlyArray<{ key: Permission; label: string; note?: string }>
}> = [
  {
    label: 'People',
    description: 'Managing the accounts in this workspace.',
    permissions: [
      { key: 'user:view', label: 'View people' },
      { key: 'user:create', label: 'Add people' },
      { key: 'user:update', label: 'Edit people', note: 'Only people ranked below them.' },
      { key: 'user:deactivate', label: 'Deactivate people' },
      { key: 'user:reset-password', label: 'Reset passwords' },
    ],
  },
  {
    label: 'Roles & teams',
    description: 'Who may change what other people are allowed to do.',
    permissions: [
      {
        key: 'role:manage',
        label: 'Manage roles',
        note: 'Powerful. Holders can create roles, but never above their own rank.',
      },
      { key: 'team:manage', label: 'Create and edit teams' },
      {
        key: 'team:manage-members',
        label: 'Manage own team members',
        note: 'Delegated: applies only to teams they manage.',
      },
    ],
  },
  {
    label: 'Projects',
    description: 'Creating projects and configuring their boards.',
    permissions: [
      { key: 'project:view', label: 'View projects' },
      { key: 'project:create', label: 'Create projects' },
      { key: 'project:update', label: 'Edit project details' },
      { key: 'project:manage-members', label: 'Manage project members' },
      { key: 'project:manage-config', label: 'Configure statuses, priorities and types' },
      { key: 'project:archive', label: 'Archive projects' },
      { key: 'project:delete', label: 'Delete projects' },
      {
        key: 'project:view-all',
        label: 'See every project',
        note: 'Visibility only — they appear in listings and search, with no extra powers.',
      },
      {
        key: 'project:access-all',
        label: 'Act in every project',
        note: 'Waives membership — their permissions apply in projects they were never added to.',
      },
    ],
  },
  {
    label: 'Tickets',
    description: 'Day-to-day work.',
    permissions: [
      { key: 'ticket:create', label: 'Create tickets' },
      { key: 'ticket:update', label: 'Edit tickets' },
      { key: 'ticket:update-any', label: "Edit anyone's ticket" },
      { key: 'ticket:transition', label: 'Change status' },
      { key: 'ticket:assign', label: 'Assign tickets' },
      { key: 'ticket:delete', label: 'Delete tickets' },
    ],
  },
  {
    label: 'Collaboration & labels',
    description: 'Comments and the project label vocabulary.',
    permissions: [
      { key: 'comment:create', label: 'Comment' },
      { key: 'comment:delete-any', label: "Delete anyone's comment" },
      { key: 'label:create', label: 'Create labels' },
      { key: 'label:update', label: 'Edit labels' },
      { key: 'label:delete', label: 'Delete labels' },
    ],
  },
  {
    label: 'Automation, AI & audit',
    description: 'Recurring work, the Copilot, and the activity record.',
    permissions: [
      { key: 'recurring:manage', label: 'Manage recurring tickets' },
      { key: 'ai:use', label: 'Use the AI Copilot' },
      { key: 'template:manage', label: 'Manage project templates' },
      { key: 'audit:view-all', label: 'View the full activity log' },
    ],
  },
]

// -----------------------------------------------------------------------------
// System roles
// -----------------------------------------------------------------------------

/**
 * Levels rank authority, lower being more senior, and are spaced so custom
 * roles can sit between the built-in ones without renumbering anything.
 */
export const ADMIN_LEVEL = 0
export const PROJECT_MANAGER_LEVEL = 20
export const USER_LEVEL = 40

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
  'team:manage-members',
  // Sees every project, but still has to be a project manager or owner to
  // configure one — which is exactly how it behaved before roles became data.
  'project:view-all',
]

export interface SystemRoleDefinition {
  key: string
  name: string
  description: string
  level: number
  permissions: readonly Permission[]
}

/**
 * The three roles every workspace starts with. They cannot be deleted or
 * re-keyed, which guarantees there is always a role able to undo a
 * misconfiguration — an editable-everything model can be locked shut by one bad
 * save, and recovering needs database access.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'Full control of the workspace, its people and every project.',
    level: ADMIN_LEVEL,
    permissions: PERMISSIONS,
  },
  {
    key: 'PROJECT_MANAGER',
    name: 'Project Manager',
    description: 'Runs projects and the people inside them, but not the workspace.',
    level: PROJECT_MANAGER_LEVEL,
    permissions: PROJECT_MANAGER_PERMISSIONS,
  },
  {
    key: 'USER',
    name: 'User',
    description: 'Works on tickets in the projects they belong to.',
    level: USER_LEVEL,
    permissions: USER_PERMISSIONS,
  },
]

export const SYSTEM_ROLE_KEYS: ReadonlySet<string> = new Set(SYSTEM_ROLES.map((r) => r.key))

// -----------------------------------------------------------------------------
// Checks
// -----------------------------------------------------------------------------

/** Does this permission set include the permission? */
export function hasPermission(
  permissions: Iterable<string>,
  permission: Permission,
): boolean {
  for (const held of permissions) if (held === permission) return true
  return false
}

/**
 * Seniority test for acting on another person or role.
 *
 * Strictly below, never equal: peers must not be able to edit each other, and
 * without that an Admin could demote another Admin — or themselves — leaving a
 * workspace with no administrator at all. It is also what stops a manager
 * granting themselves a role more powerful than the one they hold.
 */
export function outranks(actorLevel: number, targetLevel: number): boolean {
  return actorLevel < targetLevel
}

export interface ProjectAccessContext {
  permissions: readonly string[]
  /** Null when the actor is not a member of the project. */
  memberRole: ProjectMemberRole | null
  isOwner: boolean
}

/**
 * Permissions that additionally require the actor to be a project MANAGER (or
 * the project owner) when applied inside a specific project. Holding the
 * capability globally is not enough.
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

/** Evaluates a permission in the context of one project. */
export function canInProject(ctx: ProjectAccessContext, permission: Permission): boolean {
  // Layer 1: the capability itself.
  if (!hasPermission(ctx.permissions, permission)) return false

  // Layer 2: scope. `project:access-all` waives membership entirely — it does
  // not grant anything extra, so a role with it still only does what its own
  // permissions allow.
  if (hasPermission(ctx.permissions, 'project:access-all')) return true

  if (!ctx.memberRole && !ctx.isOwner) return false

  if (PROJECT_MANAGER_SCOPED.has(permission)) {
    return ctx.isOwner || ctx.memberRole === 'MANAGER'
  }

  if (
    permission.includes(':create') ||
    permission.includes(':update') ||
    permission.includes(':delete') ||
    permission.includes(':transition') ||
    permission.includes(':assign')
  ) {
    return ctx.isOwner || (ctx.memberRole != null && WRITE_CAPABLE_PROJECT_ROLES.has(ctx.memberRole))
  }

  return true
}

export const PROJECT_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  MANAGER: 'Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
}
