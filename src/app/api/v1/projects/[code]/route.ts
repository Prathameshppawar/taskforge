import type { NextRequest } from 'next/server'

import { tool, withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/** GET /api/v1/projects/DEMO — one project's details and its documents. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return withActor((actor) => tool(actor, 'get_project', { projectCode: code }, code))
}
