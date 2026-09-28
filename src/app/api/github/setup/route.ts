import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser, can } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { syncInstallation } from '@/features/github/service'

/**
 * GitHub's "setup URL": where the browser lands after the app is installed on
 * an account, or its repository grant is changed.
 *
 * The installation id arrives in the query string and is therefore untrusted.
 * It is only ever used to ask GitHub, *as our app*, for that installation — an
 * id belonging to some other app simply fails that request.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const to = (query: string) =>
    NextResponse.redirect(new URL(`/workspace/integrations?${query}`, request.nextUrl.origin))

  const actor = await getCurrentUser()
  if (!actor || !can(actor, 'integration:manage')) return to('error=forbidden')

  const raw = request.nextUrl.searchParams.get('installation_id')
  if (!raw || !/^\d+$/.test(raw)) return to('error=missing-installation')

  try {
    const { installation, repoCount } = await syncInstallation(BigInt(raw))
    await recordActivity(prisma, {
      action: request.nextUrl.searchParams.get('setup_action') === 'update' ? 'UPDATED' : 'CREATED',
      entityType: 'INTEGRATION',
      entityId: installation.id,
      entityLabel: installation.accountLogin,
      actorId: actor.id,
      summary: `connected GitHub account ${installation.accountLogin} (${repoCount} repositories)`,
    })
    return to(`installed=${encodeURIComponent(installation.accountLogin)}`)
  } catch (error) {
    console.error('[github] setup sync failed:', error)
    return to('error=sync-failed')
  }
}
