import { AsyncLocalStorage } from 'node:async_hooks'

import { prisma } from '@/infrastructure/db/prisma'
import { isPermission, type Permission } from '@/core/domain/rbac'
import type { Actor } from './guards'

/**
 * Acting as a known person, for channels with no browser session: an email
 * someone sent, a message someone wrote to the Teams bot.
 *
 * The channel authenticates the person its own way (a DMARC-passing sender,
 * a Bot Framework token naming their Teams account) and then runs the *same*
 * Server Actions the UI calls, inside `actAs`. `getCurrentUser` returns this
 * actor while the callback runs, so every permission check, transaction and
 * audit entry is exactly what that person clicking the button would produce.
 * The channel adds no authority of its own, and cannot do anything the person
 * could not do by hand.
 *
 * Server-only, and never reachable from a request: nothing a client sends can
 * choose who is acted as.
 */

const store = new AsyncLocalStorage<Actor>()

export function actingActor(): Actor | null {
  return store.getStore() ?? null
}

/** Loads an active, human account as an Actor, or null. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      avatarColor: true,
      isActive: true,
      isAgent: true,
      mustChangePassword: true,
      role: { select: { key: true, name: true, level: true, permissions: { select: { permission: true } } } },
    },
  })
  // Agents never sign in, and neither may anything that acts for them.
  if (!user || !user.isActive || user.isAgent) return null
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleKey: user.role.key,
    roleName: user.role.name,
    level: user.role.level,
    permissions: user.role.permissions.map((row) => row.permission).filter((value): value is Permission => isPermission(value)),
    avatarColor: user.avatarColor,
    mustChangePassword: user.mustChangePassword,
  }
}

export async function actAs<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return store.run(actor, fn)
}
