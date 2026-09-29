import { NextResponse, type NextRequest } from 'next/server'

import { requireActor, can } from '@/features/auth/guards'
import { teamsStatus } from '@/infrastructure/msteams/client'
import { appPackage } from '@/features/msteams/app-package'
import { appName } from '@/features/notifications/email'

/** The Teams app package for this bot, to upload in Teams. */
export async function GET(request: NextRequest) {
  const actor = await requireActor().catch(() => null)
  if (!actor || !can(actor, 'integration:manage')) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  const status = await teamsStatus()
  if (!status.connected) return NextResponse.json({ error: 'Connect the bot first.' }, { status: 400 })
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost'
  const body = appPackage({ appId: status.appId, host: host.split(':')[0], appName: appName() })
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${appName().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-teams.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
