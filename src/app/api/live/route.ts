import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectView } from '@/features/auth/guards'

export const dynamic = 'force-dynamic'

/**
 * GET /api/live?project=… — a one-line version of a project's tickets.
 *
 * The cheapest possible question: how many tickets, and when did any last
 * change? One indexed aggregate, no rows sent. The board asks every twenty
 * seconds while it is visible and refreshes only when the answer moves — far
 * cheaper than a held-open connection on a serverless host that bills for
 * every second one stays open.
 */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('project')
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })
  try {
    await requireProjectView(projectId)
  } catch {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }
  const settings = await prisma.projectSettings.findUnique({ where: { projectId }, select: { liveUpdates: true } })
  if (!settings?.liveUpdates) return NextResponse.json({ enabled: false })
  const [aggregate, comments] = await Promise.all([
    prisma.ticket.aggregate({ where: { projectId }, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.comment.aggregate({ where: { ticket: { projectId } }, _max: { createdAt: true } }),
  ])
  return NextResponse.json(
    { enabled: true, version: `${aggregate._count._all}:${aggregate._max.updatedAt?.getTime() ?? 0}:${comments._max.createdAt?.getTime() ?? 0}` },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
