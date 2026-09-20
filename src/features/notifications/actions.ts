'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { requireActor } from '@/features/auth/guards'
import { ok, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { getNotifications, getUnreadCount } from './queries'

export async function markNotificationReadAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    // Scoped by userId, so one user cannot mark another's notification read.
    await prisma.notification.updateMany({
      where: { id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    })
    revalidatePath('/inbox')
    return ok()
  })
}

export async function markAllReadAction(): Promise<ActionResult<{ marked: number }>> {
  return runAction(async () => {
    const actor = await requireActor()
    const result = await prisma.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    })
    revalidatePath('/inbox')
    return ok({ marked: result.count })
  })
}

/** Polled by the header bell. */
export async function fetchNotificationsAction() {
  const actor = await requireActor()
  const [items, unread] = await Promise.all([
    getNotifications(actor, 15),
    getUnreadCount(actor),
  ])
  return { items, unread }
}

/**
 * Turn the notification chime on or off for the signed-in person.
 *
 * Always scoped to the actor — there is no administrative override here, since
 * whether someone's speakers make a noise is theirs to decide.
 */
export async function setNotificationSoundAction(
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean }>> {
  return runAction(async () => {
    const actor = await requireActor()
    await prisma.user.update({
      where: { id: actor.id },
      data: { notificationSound: enabled },
    })
    // The bell reads this preference in the app layout, so every route's shell
    // is stale once it changes — not just the settings page that changed it.
    revalidatePath('/', 'layout')
    return ok({ enabled })
  })
}
