'use server'

import { revalidatePath } from 'next/cache'
import { AuthError } from 'next-auth'

import { signIn, signOut } from '@/auth'
import { prisma } from '@/infrastructure/db/prisma'
import { hashPassword, verifyPassword } from '@/infrastructure/auth/password'
import { recordActivity } from '@/features/activity/service'
import { requireActor, requireAdmin } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { pickAvatarColor } from '@/lib/utils'
import {
  adminResetPasswordSchema,
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  setUserActiveSchema,
  updateProfileSchema,
  updateUserSchema,
  type AdminResetPasswordInput,
  type ChangePasswordInput,
  type CreateUserInput,
  type LoginInput,
  type SetUserActiveInput,
  type UpdateProfileInput,
  type UpdateUserInput,
} from './schemas'

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------

export async function loginAction(input: LoginInput): Promise<ActionResult<void>> {
  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    })
  }

  try {
    await signIn('credentials', {
      username: parsed.data.username,
      password: parsed.data.password,
      redirect: false,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately generic: do not reveal whether the username exists or the
      // account is deactivated.
      return fail('Incorrect username or password, or the account is inactive.', {
        code: 'INVALID_CREDENTIALS',
      })
    }
    throw error
  }

  // Best-effort login audit. A failure here must not block sign-in.
  try {
    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username.trim().toLowerCase() },
      select: { id: true, name: true },
    })
    if (user) {
      await recordActivity(prisma, {
        action: 'LOGGED_IN',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: user.name,
        actorId: user.id,
        summary: `${user.name} signed in`,
      })
    }
  } catch {
    // ignored
  }

  return ok()
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

// -----------------------------------------------------------------------------
// Admin: user management
// -----------------------------------------------------------------------------

export async function createUserAction(input: CreateUserInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireAdmin()
    const data = createUserSchema.parse(input)

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.email }] },
      select: { username: true, email: true },
    })

    if (existing) {
      const field = existing.username === data.username ? 'username' : 'email'
      return fail(
        field === 'username'
          ? 'That username is already taken.'
          : 'That email address is already registered.',
        { code: 'CONFLICT', fieldErrors: { [field]: ['Already in use.'] } },
      )
    }

    const role = await prisma.role.findUnique({ where: { key: data.roleKey } })
    if (!role) throw new NotFoundError('Role', data.roleKey)

    const passwordHash = await hashPassword(data.password)

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: data.username,
          email: data.email,
          name: data.name,
          jobTitle: data.jobTitle || null,
          passwordHash,
          roleId: role.id,
          mustChangePassword: data.mustChangePassword,
          avatarColor: pickAvatarColor(data.username),
          createdById: actor.id,
        },
        select: { id: true, name: true },
      })

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'USER',
        entityId: created.id,
        entityLabel: created.name,
        actorId: actor.id,
        summary: `created user ${created.name} (${data.roleKey})`,
      })

      return created
    })

    revalidatePath('/admin/users')
    return ok({ id: user.id })
  })
}

export async function updateUserAction(input: UpdateUserInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireAdmin()
    const data = updateUserSchema.parse(input)

    const before = await prisma.user.findUnique({
      where: { id: data.id },
      select: {
        id: true,
        name: true,
        email: true,
        jobTitle: true,
        role: { select: { key: true, id: true } },
      },
    })
    if (!before) throw new NotFoundError('User', data.id)

    // Guard against the last admin demoting themselves out of existence.
    if (before.role.key === 'ADMIN' && data.roleKey !== 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: { key: 'ADMIN' }, isActive: true },
      })
      if (adminCount <= 1) {
        throw new BusinessRuleError(
          'This is the only active administrator. Promote another user to Admin before changing this role.',
        )
      }
    }

    const role = await prisma.role.findUnique({ where: { key: data.roleKey } })
    if (!role) throw new NotFoundError('Role', data.roleKey)

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: data.id },
        data: {
          name: data.name,
          email: data.email,
          jobTitle: data.jobTitle || null,
          roleId: role.id,
        },
      })

      if (before.role.key !== data.roleKey) {
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'USER',
          entityId: data.id,
          entityLabel: data.name,
          actorId: actor.id,
          field: 'role',
          oldValue: before.role.key,
          newValue: data.roleKey,
          summary: `changed ${data.name}'s role to ${data.roleKey}`,
        })
      }

      if (before.name !== data.name || before.email !== data.email) {
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'USER',
          entityId: data.id,
          entityLabel: data.name,
          actorId: actor.id,
          summary: `updated ${data.name}'s profile`,
        })
      }
    })

    revalidatePath('/admin/users')
    return ok()
  })
}

export async function setUserActiveAction(input: SetUserActiveInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireAdmin()
    const data = setUserActiveSchema.parse(input)

    if (data.userId === actor.id && !data.isActive) {
      throw new BusinessRuleError('You cannot deactivate your own account.')
    }

    const target = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true, isActive: true, role: { select: { key: true } } },
    })
    if (!target) throw new NotFoundError('User', data.userId)

    if (!data.isActive && target.role.key === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: { key: 'ADMIN' }, isActive: true },
      })
      if (adminCount <= 1) {
        throw new BusinessRuleError('You cannot deactivate the only active administrator.')
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: data.userId },
        data: {
          isActive: data.isActive,
          deactivatedAt: data.isActive ? null : new Date(),
          ...(data.isActive ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
          // Bumping the version invalidates every JWT already issued to them.
          sessionVersion: data.isActive ? undefined : { increment: 1 },
        },
      })

      if (!data.isActive) {
        await tx.userSession.updateMany({
          where: { userId: data.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }

      await recordActivity(tx, {
        action: data.isActive ? 'ACTIVATED' : 'DEACTIVATED',
        entityType: 'USER',
        entityId: data.userId,
        entityLabel: target.name,
        actorId: actor.id,
        summary: `${data.isActive ? 'activated' : 'deactivated'} ${target.name}`,
      })
    })

    revalidatePath('/admin/users')
    return ok()
  })
}

export async function adminResetPasswordAction(
  input: AdminResetPasswordInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireAdmin()
    const data = adminResetPasswordSchema.parse(input)

    const target = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true },
    })
    if (!target) throw new NotFoundError('User', data.userId)

    const passwordHash = await hashPassword(data.password)

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: data.userId },
        data: {
          passwordHash,
          mustChangePassword: data.mustChangePassword,
          // Force every existing session for this user to be rejected.
          sessionVersion: { increment: 1 },
          // A reset is also the remedy for being locked out.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      })

      await tx.userSession.updateMany({
        where: { userId: data.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      await recordActivity(tx, {
        action: 'PASSWORD_RESET',
        entityType: 'USER',
        entityId: data.userId,
        entityLabel: target.name,
        actorId: actor.id,
        summary: `reset the password for ${target.name}`,
      })
    })

    revalidatePath('/admin/users')
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Self-service
// -----------------------------------------------------------------------------

export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    const data = changePasswordSchema.parse(input)

    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, name: true, passwordHash: true },
    })
    if (!user) throw new NotFoundError('User', actor.id)

    const valid = await verifyPassword(data.currentPassword, user.passwordHash)
    if (!valid) {
      return fail('Your current password is incorrect.', {
        fieldErrors: { currentPassword: ['Incorrect password.'] },
      })
    }

    const passwordHash = await hashPassword(data.newPassword)

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, mustChangePassword: false },
      })

      await recordActivity(tx, {
        action: 'PASSWORD_RESET',
        entityType: 'USER',
        entityId: actor.id,
        entityLabel: user.name,
        actorId: actor.id,
        summary: 'changed their own password',
      })
    })

    revalidatePath('/settings')
    return ok()
  })
}

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    const data = updateProfileSchema.parse(input)

    await prisma.user.update({
      where: { id: actor.id },
      data: { name: data.name, jobTitle: data.jobTitle || null },
    })

    revalidatePath('/settings')
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Session visibility
// -----------------------------------------------------------------------------

/**
 * Sign-in history, for the admin.
 *
 * UserSession rows were written from the first commit and never read — the
 * table was write-only, so an admin could not answer "who is signed in?".
 */
export async function listSessionsAction() {
  await requireAdmin()

  return prisma.userSession.findMany({
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      lastSeenAt: true,
      revokedAt: true,
      user: {
        select: { id: true, name: true, username: true, avatarColor: true, isActive: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

/**
 * Ends every session for a user.
 *
 * Bumping sessionVersion is what actually does it — the JWT carries the version
 * and is re-checked against the database, so existing tokens stop being
 * accepted rather than merely being marked revoked in a table nobody consults.
 */
export async function revokeUserSessionsAction(
  userId: string,
): Promise<ActionResult<{ revoked: number }>> {
  return runAction(async () => {
    const actor = await requireAdmin()

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    })
    if (!target) throw new NotFoundError('User', userId)

    const revoked = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      })

      const result = await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      await recordActivity(tx, {
        action: 'DEACTIVATED',
        entityType: 'USER',
        entityId: userId,
        entityLabel: target.name,
        actorId: actor.id,
        summary: `signed ${target.name} out of every device`,
      })

      return result.count
    })

    revalidatePath('/admin/sessions')
    return ok({ revoked })
  })
}
