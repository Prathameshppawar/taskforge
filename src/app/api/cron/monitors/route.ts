import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import { runDueMonitors } from '@/features/monitors/service'
import { sweepSlaAlerts } from '@/features/tickets/flow'
import { pollMailbox } from '@/features/inbound-email/service'

/**
 * Uptime checks, SLA alerts and email in, every five minutes.
 *
 * Driven by `.github/workflows/uptime.yml` rather than Vercel Cron, which runs
 * at most daily on the hobby plan. Guarded by the same CRON_SECRET as the
 * daily sweep; only monitors whose interval has elapsed are checked, so
 * calling it more often is harmless.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const started = Date.now()
  const [result, sla, email] = await Promise.all([
    runDueMonitors(),
    // A failed sweep must not hide the monitors' result, or the reverse.
    sweepSlaAlerts().catch((error) => {
      console.error('[cron] SLA sweep failed:', error)
      return { checked: 0, sent: 0, error: true }
    }),
    pollMailbox().catch((error) => {
      console.error('[cron] mailbox poll failed:', error)
      return { read: 0, outcomes: {}, error: error instanceof Error ? error.message : 'failed' }
    }),
  ])
  return NextResponse.json({ ok: true, ...result, sla, email, durationMs: Date.now() - started })
}
