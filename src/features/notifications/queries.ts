import { prisma } from '@/infrastructure/db/prisma'
import type { Actor } from '@/features/auth/guards'

const SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  actor: { select: { id: true, name: true, avatarColor: true } },
  ticket: { select: { key: true, title: true } },
} as const

export async function getNotifications(actor: Actor, take = 30) {
  return prisma.notification.findMany({
    where: { userId: actor.id },
    select: SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}

/** Served by the (userId, readAt, createdAt) index — cheap enough to poll. */
export async function getUnreadCount(actor: Actor): Promise<number> {
  return prisma.notification.count({
    where: { userId: actor.id, readAt: null },
  })
}

/**
 * The delivery preferences the app shell needs on every page.
 *
 * Returns a default rather than throwing if the row has vanished mid-request
 * (a deactivated account being cleaned up, say): the layout renders a bell
 * either way, and a missing user is the session guard's problem, not this
 * query's.
 */
export async function getNotificationPreferences(
  actor: Actor,
): Promise<{ sound: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { notificationSound: true },
  })
  return { sound: user?.notificationSound ?? true }
}

export type NotificationItem = Awaited<ReturnType<typeof getNotifications>>[number]
