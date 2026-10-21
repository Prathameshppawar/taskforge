import { NextResponse, type NextRequest } from 'next/server'

import { badBody, body, tool, withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/** GET /api/v1/projects/DEMO/proposals?status=pending|approved|rejected|superseded */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return withActor((actor) => {
    const status = request.nextUrl.searchParams.get('status')
    return tool(actor, 'list_proposals', { projectCode: code, status: status?.toUpperCase() ?? undefined }, code)
  })
}

/**
 * POST /api/v1/projects/DEMO/proposals —
 * { kind: 'DOCUMENT', name, body, title?, baseVersion?, summary?, rationale? }
 * or { kind: 'PROJECT_DETAILS', description?, status?, startDate?, endDate?, summary?, rationale? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return withActor(async (actor) => {
    const data = await body(request)
    if (!data) return badBody()
    const { kind, ...args } = data
    if (kind === 'DOCUMENT') {
      return tool(actor, 'propose_document', { ...args, projectCode: code }, code, true)
    }
    if (kind === 'PROJECT_DETAILS') {
      return tool(actor, 'propose_project_update', { ...args, projectCode: code }, code, true)
    }
    return NextResponse.json({ ok: false, error: 'kind must be DOCUMENT or PROJECT_DETAILS.' }, { status: 400 })
  })
}
