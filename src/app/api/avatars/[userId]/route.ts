import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser } from '@/features/auth/guards'
import { sniffImageType } from '@/features/profile/avatar'

/**
 * Serves a profile photo to anyone signed in. Names and initials are already
 * visible to every member, and a face is no more private than the name under
 * it. Signed-out requests get nothing.
 *
 * The URL carries `?v=<avatarUpdatedAt>`, so a new photo is a new URL and this
 * one can be cached for a year. Node runtime: the bytes come from Prisma.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const actor = await getCurrentUser()
  if (!actor) return new NextResponse('Unauthorized', { status: 401 })

  const { userId } = await params
  const image = await prisma.userAvatarImage.findUnique({
    where: { userId },
    select: { content: true },
  })
  if (!image) return new NextResponse('Not found', { status: 404 })

  const body = new Uint8Array(image.content)
  // Re-sniffed rather than trusting the stored type, so a row written by any
  // other path still cannot be served as something a browser would execute.
  const contentType = sniffImageType(body)
  if (!contentType) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  })
}
