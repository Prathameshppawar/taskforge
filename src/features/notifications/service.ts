import type { NotificationType, Prisma } from '@prisma/client'

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
 */
export async function notify(tx: Tx, input: NotifyInput): Promise<number> {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId)
  if (recipients.length === 0) return 0

  await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      actorId: input.actorId,
      ticketId: input.ticketId ?? null,
      commentId: input.commentId ?? null,
      title: input.title,
      body: input.body ?? null,
    })),
  })

  return recipients.length
}

/** Truncates a comment for the notification preview. */
export function preview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
