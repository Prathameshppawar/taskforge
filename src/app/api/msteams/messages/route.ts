import { after, NextResponse, type NextRequest } from 'next/server'

import { isAllowedServiceUrl, verifyIncoming } from '@/infrastructure/msteams/client'
import { handleActivity, type Activity } from '@/features/msteams/service'

/**
 * The Teams bot's messaging endpoint.
 *
 * Nothing in the request is believed until its Bot Framework token verifies.
 * Teams wants an answer within seconds and a brainstorm turn can take longer,
 * so the request is acknowledged at once and the reply is posted afterwards
 * through the Bot Connector.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const activity = (await request.json().catch(() => null)) as Activity | null
  if (!activity?.serviceUrl || !activity.conversation?.id || !activity.from?.id) {
    return NextResponse.json({ error: 'Not an activity.' }, { status: 400 })
  }
  if (!isAllowedServiceUrl(activity.serviceUrl)) return NextResponse.json({ error: 'Unknown service URL.' }, { status: 403 })

  const verdict = await verifyIncoming(request.headers.get('authorization'), activity)
  if (!verdict.ok) return NextResponse.json({ error: `Unauthorized: ${verdict.reason}.` }, { status: 401 })

  after(() => handleActivity(activity).catch((error) => console.error('[msteams] activity failed:', error)))
  return NextResponse.json({})
}
