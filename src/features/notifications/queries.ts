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

export type NotificationItem = Awaited<ReturnType<typeof getNotifications>>[number]
