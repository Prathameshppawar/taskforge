import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { convertManifest } from '@/infrastructure/github/client'
import { getCurrentUser, can } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { saveManifestApp, type GhManifestConversion } from '@/features/github/service'

/**
 * GitHub redirects here after creating the app from our manifest.
 *
 * Exchanges the one-time code for the app's credentials, stores them sealed,
 * then sends the person straight on to installing it — the step that actually
 * grants repositories — so creating and connecting feel like one action.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/workspace/integrations?error=${reason}`, request.nextUrl.origin))

  const actor = await getCurrentUser()
  if (!actor || !can(actor, 'integration:manage')) return back('forbidden')

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expected = request.cookies.get('gh_manifest_state')?.value

  if (!code) return back('missing-code')
  if (!state || !expected || state !== expected) return back('state-mismatch')

  let app: GhManifestConversion
  try {
    app = await convertManifest<GhManifestConversion>(code)
  } catch (error) {
    console.error('[github] manifest conversion failed:', error)
    return back('conversion-failed')
  }

  await saveManifestApp(app)
  await recordActivity(prisma, {
    action: 'CREATED',
    entityType: 'INTEGRATION',
    entityId: String(app.id),
    entityLabel: app.name,
    actorId: actor.id,
    summary: `created the GitHub App "${app.name}"`,
  })

  const response = NextResponse.redirect(`${app.html_url}/installations/new`)
  response.cookies.delete({ name: 'gh_manifest_state', path: '/api/github' })
  return response
}
