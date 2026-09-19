import { prisma } from '@/infrastructure/db/prisma'
import type { Actor } from '@/features/auth/guards'
import { outranks, SYSTEM_ROLE_KEYS } from '@/core/domain/rbac'
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/core/domain/errors'

/**
 * Seniority guards.
 *
 * Holding `role:manage` or `user:update` says you may administer *somebody*; it
 * does not say whom. These decide that, and they are the difference between
 * delegated administration and a privilege escalation: without them anyone who
 * can edit a role can grant themselves every permission in one step.
 *
 * Every check is "strictly below". Peers may not act on each other, so two
 * administrators cannot demote one another and nobody can edit their own rank.
 */

/** The role a user may be given: it must exist, and rank below the grantor. */
export async function assertCanGrantRole(actor: Actor, roleKey: string) {
  const role = await prisma.role.findUnique({
    where: { key: roleKey },
    select: { id: true, key: true, name: true, level: true },
  })

  if (!role) throw new NotFoundError('Role', roleKey)

  if (!outranks(actor.level, role.level)) {
    throw new ForbiddenError(
      `You cannot grant "${role.name}" — it ranks at or above your own role.`,
    )
  }

  return role
}

/** The person being acted on must rank below the actor. */
export async function assertCanActOnUser(actor: Actor, userId: string) {
  // Acting on yourself is not a seniority question — the caller decides whether
  // self-service is allowed, and several actions deliberately permit it.
  if (userId === actor.id) return null

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: { select: { key: true, name: true, level: true } } },
  })

  if (!target) throw new NotFoundError('User', userId)

  if (!outranks(actor.level, target.role.level)) {
    throw new ForbiddenError(
      `${target.name} holds "${target.role.name}", which ranks at or above your own role.`,
    )
  }

  return target
}

/** An existing role may only be edited or deleted by someone ranked above it. */
export async function assertCanEditRole(actor: Actor, roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      key: true,
      name: true,
      level: true,
      isSystem: true,
      _count: { select: { users: true } },
    },
  })

  if (!role) throw new NotFoundError('Role', roleId)

  if (role.isSystem) {
    throw new BusinessRuleError(
      `"${role.name}" is a built-in role and cannot be changed. Create a custom role instead.`,
    )
  }

  if (!outranks(actor.level, role.level)) {
    throw new ForbiddenError(
      `"${role.name}" ranks at or above your own role, so you cannot change it.`,
    )
  }

  return role
}

/**
 * A role may not hand out more than its author holds.
 *
 * Otherwise `role:manage` is effectively every permission: create a role with
 * the permissions you lack, assign it to yourself — or to someone who will
 * assign it back — and the ceiling has been walked around in two steps.
 */
export function assertPermissionsWithinGrant(actor: Actor, requested: readonly string[]) {
  const held = new Set<string>(actor.permissions)
  const excess = requested.filter((permission) => !held.has(permission))

  if (excess.length > 0) {
    throw new ForbiddenError(
      `You cannot grant permissions you do not hold yourself: ${excess.join(', ')}.`,
    )
  }
}

/** Guards the reserved keys so a system role can never be shadowed or replaced. */
export function assertKeyAvailable(key: string) {
  if (SYSTEM_ROLE_KEYS.has(key.toUpperCase())) {
    throw new BusinessRuleError(`"${key}" is reserved for a built-in role.`)
  }
}
