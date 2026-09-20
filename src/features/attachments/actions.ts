'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectPermission, requireProjectView } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { storedContentType, validateUpload } from './service'

/**
 * Uploads take a FormData rather than a JSON body, because a Server Action that
 * accepts a File is the only way to get bytes here without building a separate
 * upload endpoint with its own authentication.
 */
export async function uploadAttachmentAction(
  form: FormData,
): Promise<ActionResult<{ id: string; filename: string }>> {
  return runAction(async () => {
    const ticketId = String(form.get('ticketId') ?? '')
    const file = form.get('file')

    if (!ticketId) return fail('No ticket given.')
    if (!(file instanceof File)) return fail('No file given.')

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, key: true, projectId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', ticketId)

    // Attaching is editing the ticket, so it takes the same permission.
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')

    const existingCount = await prisma.ticketAttachment.count({ where: { ticketId } })
    const verdict = validateUpload(file.size, existingCount)
    if (!verdict.ok) return fail(verdict.reason)

    const bytes = Buffer.from(await file.arrayBuffer())

    // The size is re-read from the bytes actually received rather than trusted
    // from the File, which is a client-supplied number.
    const recheck = validateUpload(bytes.byteLength, existingCount)
    if (!recheck.ok) return fail(recheck.reason)

    const created = await prisma.$transaction(async (tx) => {
      const attachment = await tx.ticketAttachment.create({
        data: {
          ticketId,
          filename: file.name || 'upload',
          contentType: storedContentType(file.type),
          size: bytes.byteLength,
          uploadedById: actor.id,
          data: { create: { content: bytes } },
        },
        select: { id: true, filename: true },
      })

      await recordActivity(tx, {
        action: 'RESOURCE_ADDED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        summary: `attached ${attachment.filename}`,
      })

      return attachment
    })

    revalidatePath(`/tickets/${ticket.key}`)
    return ok(created)
  })
}

export async function deleteAttachmentAction(
  attachmentId: string,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const attachment = await prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        filename: true,
        ticket: { select: { id: true, key: true, projectId: true } },
      },
    })
    if (!attachment) return fail('That file is already gone.')

    const { actor } = await requireProjectPermission(
      attachment.ticket.projectId,
      'ticket:update',
    )

    await prisma.$transaction(async (tx) => {
      // The bytes cascade with the row.
      await tx.ticketAttachment.delete({ where: { id: attachment.id } })
      await recordActivity(tx, {
        action: 'RESOURCE_REMOVED',
        entityType: 'TICKET',
        entityId: attachment.ticket.id,
        entityLabel: attachment.ticket.key,
        projectId: attachment.ticket.projectId,
        ticketId: attachment.ticket.id,
        actorId: actor.id,
        summary: `removed ${attachment.filename}`,
      })
    })

    revalidatePath(`/tickets/${attachment.ticket.key}`)
    return ok(undefined)
  })
}

/** Metadata only — the bytes are served by the download route. */
export async function listAttachments(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { projectId: true },
  })
  if (!ticket) return []

  await requireProjectView(ticket.projectId)

  return prisma.ticketAttachment.findMany({
    where: { ticketId },
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
      createdAt: true,
      uploadedBy: { select: { name: true, avatarColor: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
}
