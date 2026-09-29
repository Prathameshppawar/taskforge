import type { NextRequest } from 'next/server'

import { badBody, body, tool, withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/tickets?project=DEMO&q=…&status=…&category=DONE&priority=…&type=…&label=…&assignee=me&overdue=1&unassigned=1&limit=50
 */
export async function GET(request: NextRequest) {
  return withActor(async (actor) => {
    const params = request.nextUrl.searchParams
    const project = params.get('project')
    return tool(
      actor,
      'search_tickets',
      {
        query: params.get('q') ?? undefined,
        projectCode: project ?? undefined,
        status: params.get('status') ?? undefined,
        statusCategory: params.get('category')?.toUpperCase() ?? undefined,
        priority: params.get('priority') ?? undefined,
        type: params.get('type') ?? undefined,
        label: params.get('label') ?? undefined,
        assignee: params.get('assignee') ?? undefined,
        overdueOnly: params.get('overdue') === '1' || undefined,
        unassignedOnly: params.get('unassigned') === '1' || undefined,
        limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      },
      project,
    )
  })
}

/**
 * POST /api/v1/tickets — { project, title, description?, type?, priority?, assignee?, labels?, dueInDays?, parentKey?, acceptanceCriteria? }
 */
export async function POST(request: NextRequest) {
  return withActor(async (actor) => {
    const data = await body(request)
    if (!data) return badBody()
    const { project, ...rest } = data
    return tool(actor, 'create_ticket', { ...rest, projectCode: typeof project === 'string' ? project : undefined }, typeof project === 'string' ? project : null, true)
  })
}
