import type { NextRequest } from 'next/server'

import { badBody, body, tool, withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/** POST /api/v1/tickets/DEMO-12/comments — { body } in Markdown; @username notifies. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return withActor(async (actor) => {
    const data = await body(request)
    if (!data || typeof data.body !== 'string') return badBody()
    return tool(actor, 'comment_on_ticket', { ticketKey: key, body: data.body }, null, true)
  })
}
