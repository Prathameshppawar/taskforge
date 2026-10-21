import type { NextRequest } from 'next/server'

import { tool, withActor } from '@/features/public-api/handler'

export const dynamic = 'force-dynamic'

/** A malformed escape is a name that matches nothing, not a server error. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** GET /api/v1/projects/DEMO/documents/architecture?version=2 — the latest version unless one is given. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string; name: string }> }) {
  const { code, name } = await params
  return withActor((actor) => {
    const version = request.nextUrl.searchParams.get('version')
    return tool(
      actor,
      'get_document',
      {
        name: safeDecode(name),
        projectCode: code,
        version: version ? Number(version) : undefined,
      },
      code,
    )
  })
}
