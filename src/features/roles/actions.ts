'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requirePermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { isPermission, ADMIN_LEVEL } from '@/core/domain/rbac'
import {
  assertCanEditRole,
  assertKeyAvailable,
  assertPermissionsWithinGrant,
} from './service'

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Name this role.').max(60),
  description: z.string().trim().max(200).nullable().optional(),
  /**
   * Bounded below by Admin's level: nothing may be created at or above the top
   * rank, whatever the form sends.
   */
  level: z.coerce.number().int().min(ADMIN_LEVEL + 1).max(1000),
  permissions: z.array(z.string()).max(100),
})

const createRoleSchema = roleSchema.extend({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Use capitals, digits and underscores, e.g. TEAM_LEAD.'),
})

const updateRoleSchema = roleSchema.extend({ id: z.string().min(1) })

export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>

/** Drops anything the compile-time catalogue does not recognise. */
function cleanPermissions(values: string[]): string[] {
  return [...new Set(values.filter(isPermission))]
}

export async function createRoleAction(
  input: CreateRoleInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermission('role:manage')
    const data = createRoleSchema.parse(input)

    const key = data.key.toUpperCase()
    assertKeyAvailable(key)

    // A role you could not yourself be given is one you cannot create.
    if (data.level <= actor.level) {
      throw new BusinessRuleError(
        'A new role must rank below your own, otherwise you would be granting authority you do not hold.',
      )
    }

    const permissions = cleanPermissions(data.permissions)
    assertPermissionsWithinGrant(actor, permissions)

    const existing = await prisma.role.findUnique({ where: { key }, select: { id: true } })
    if (existing) {
      return fail('A role with that key already exists.', {
        code: 'CONFLICT',
        fieldErrors: { key: ['Already in use.'] },
      })
    }

    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          key,
          name: data.name,
          description: data.description ?? null,
          level: data.level,
          isSystem: false,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
        select: { id: true },
      })

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'ROLE',
        entityId: created.id,
        entityLabel: data.name,
        actorId: actor.id,
        summary: `Created role "${data.name}" with ${permissions.length} permissions`,
      })

      return created
    })

    revalidatePath('/admin/roles')
    revalidatePath('/admin/users')
    return ok({ id: role.id })
  })
}

export async function updateRoleAction(input: UpdateRoleInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('role:manage')
    const data = updateRoleSchema.parse(input)

    const role = await assertCanEditRole(actor, data.id)

    if (data.level <= actor.level) {
      throw new BusinessRuleError('A role must rank below your own.')
    }

    const permissions = cleanPermissions(data.permissions)
    assertPermissionsWithinGrant(actor, permissions)

    await prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: role.id },
        data: {
          name: data.name,
          description: data.description ?? null,
          level: data.level,
        },
      })

      // Replace the set rather than diffing it: the form always submits the
      // complete selection, so anything absent was deliberately unticked.
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permission: { notIn: permissions } },
      })
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      })

      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'ROLE',
        entityId: role.id,
        entityLabel: data.name,
        actorId: actor.id,
        summary: `Updated role "${data.name}" — ${permissions.length} permissions, level ${data.level}`,
      })
    })

    revalidatePath('/admin/roles')
    revalidatePath('/admin/users')
    return ok(undefined)
  })
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('role:manage')
    const role = await assertCanEditRole(actor, roleId)

    // The FK is Restrict, so the database would refuse anyway — but a foreign
    // key violation is not an explanation, and the person needs to know which
    // accounts are in the way.
    if (role._count.users > 0) {
      throw new BusinessRuleError(
        `${role._count.users} ${role._count.users === 1 ? 'person holds' : 'people hold'} this role. Move them to another role first.`,
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: role.id } })
      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'ROLE',
        entityId: role.id,
        entityLabel: role.name,
        actorId: actor.id,
        summary: `Deleted role "${role.name}"`,
      })
    })

    revalidatePath('/admin/roles')
    return ok(undefined)
  })
}
