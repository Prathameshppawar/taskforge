import { NextResponse } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { projectVisibilityFilter } from '@/features/auth/guards'
import { withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/** GET /api/v1/projects — the projects the token's owner can see. */
export async function GET() {
  return withActor(async (actor) => {
    const projects = await prisma.project.findMany({
      where: { isArchived: false, ...projectVisibilityFilter(actor) },
      orderBy: { name: 'asc' },
      select: { code: true, name: true, status: true, description: true, startDate: true, endDate: true },
    })
    return NextResponse.json({ ok: true, data: projects })
  })
}
