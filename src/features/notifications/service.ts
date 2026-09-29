import type { NotificationType, Prisma } from '@prisma/client'

import { emailNotificationsLater } from './email'

type Tx = Prisma.TransactionClient

export interface NotifyInput {
  userIds: string[]
  type: NotificationType
  actorId: string
  ticketId?: string | null
  commentId?: string | null
  title: string
  body?: string | null
}

/**
 * Writes notifications inside the caller's transaction, alongside the change
 * that caused them — so a rolled-back comment never leaves a notification
 * pointing at something that does not exist.
 *
 * Never notifies the actor about their own action: being told you mentioned
 * yourself is noise, and self-assignment is something you already know about.
 *
 * Also emails each recipient who has not turned that off — once the
 * transaction is over, never from inside it (see `emailNotificationsLater`).
 */
export async function notify(tx: Tx, input: NotifyInput): Promise<number> {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId)
  if (recipients.length === 0) return 0

  const created = await tx.notification.createManyAndReturn({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      actorId: input.actorId,
      ticketId: input.ticketId ?? null,
      commentId: input.commentId ?? null,
      title: input.title,
      body: input.body ?? null,
    })),
    select: { id: true },
  })

  emailNotificationsLater(created.map((row) => row.id))
  return recipients.length
}

/** Truncates a comment for the notification preview. */
export function preview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
