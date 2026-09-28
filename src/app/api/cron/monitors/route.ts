import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import { runDueMonitors } from '@/features/monitors/service'

/**
 * Uptime checks, every five minutes.
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
  const result = await runDueMonitors()
  return NextResponse.json({ ok: true, ...result, durationMs: Date.now() - started })
}
