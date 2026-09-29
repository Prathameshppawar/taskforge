import type { NextRequest } from 'next/server'

import { badBody, body, tool, withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/** GET /api/v1/tickets/DEMO-12 — one ticket in full. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return withActor((actor) => tool(actor, 'get_ticket', { ticketKey: key }))
}

/** PATCH /api/v1/tickets/DEMO-12 — { status?, priority?, assignee?, dueInDays?, addLabels?, title? } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return withActor(async (actor) => {
    const data = await body(request)
    if (!data) return badBody()
    return tool(actor, 'update_ticket', { ...data, ticketKey: key })
  })
}
