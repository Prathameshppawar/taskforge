import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser, getProjectAccess } from '@/features/auth/guards'
import { contentDisposition, isInlineType } from '@/features/attachments/service'

/**
 * Serves an attachment.
 *
 * Every request is authorised — there are no unguessable-URL downloads here,
 * because an id that leaks in a screenshot or a referrer would otherwise be a
 * permanent public link to somebody's file.
 *
 * Node runtime: the bytes come from Prisma.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const actor = await getCurrentUser()
  if (!actor) return new NextResponse('Unauthorized', { status: 401 })

  const attachment = await prisma.ticketAttachment.findUnique({
    where: { id },
    select: {
      filename: true,
      contentType: true,
      size: true,
      ticket: { select: { projectId: true } },
    },
  })

  if (!attachment) return new NextResponse('Not found', { status: 404 })

  // Reuses the project access the rest of the app uses, so a file is exactly as
  // visible as the ticket holding it.
  const access = await getProjectAccess(attachment.ticket.projectId, actor).catch(() => null)
  const canSee =
    access !== null &&
    (access.isOwner ||
      access.memberRole !== null ||
      access.permissions.includes('project:view-all') ||
      access.permissions.includes('project:access-all'))

  // 404 rather than 403: telling somebody a file exists but is not theirs is
  // itself a disclosure.
  if (!canSee) return new NextResponse('Not found', { status: 404 })

  const data = await prisma.ticketAttachmentData.findUnique({
    where: { attachmentId: id },
    select: { content: true },
  })
  if (!data) return new NextResponse('Not found', { status: 404 })

  const body = new Uint8Array(data.content)

  return new NextResponse(body, {
    headers: {
      'Content-Type': isInlineType(attachment.contentType)
        ? attachment.contentType
        : 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Content-Disposition': contentDisposition(attachment.filename, attachment.contentType),
      // Belt and braces alongside the global header: never let the browser
      // guess a type more dangerous than the one we chose.
      'X-Content-Type-Options': 'nosniff',
      // A file is per-user authorised, so a shared cache must never keep it.
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
