import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { generateDueTickets } from '@/features/recurring/service'
import { sweepEmbeddings } from '@/features/tickets/embeddings'

/**
 * Recurring ticket scheduler.
 *
 * Invoked by Vercel Cron (see vercel.json) or any external scheduler. Guarded
 * by a shared secret rather than a session, because there is no user here.
 *
 * Deliberately idempotent-ish: running it more often than necessary is
 * harmless, since each schedule only fires when nextRunAt has passed and is
 * then advanced beyond the current time.
 */
export const dynamic = 'force-dynamic'
// The embedding sweep loads a model on a cold start, so the default 10s ceiling
// is not enough headroom.
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server.' },
      { status: 503 },
    )
  }

  // Vercel Cron sends the secret as a Bearer token; allow a query parameter
  // too so the endpoint can be driven by schedulers that cannot set headers.
  const header = request.headers.get('authorization')
  const provided =
    header?.replace(/^Bearer\s+/i, '') ?? request.nextUrl.searchParams.get('key') ?? ''

  if (!timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const startedAt = Date.now()

  try {
    const result = await generateDueTickets(prisma)

    /*
     * Embeddings are refreshed on the same schedule rather than in the request
     * that edits a ticket. Loading the model costs a couple of seconds the first
     * time a process needs it, which is fine once a day in a background job and
     * not fine in the path of somebody saving a title.
     *
     * Bounded, and failure is swallowed: a missing embedding costs recall in
     * duplicate detection, which is not worth failing the recurring sweep over.
     */
    const embeddings = await sweepEmbeddings(300).catch((error) => {
      console.error('[cron/recurring] embedding sweep failed:', error)
      return { embedded: 0, remaining: -1 }
    })

    return NextResponse.json({
      ok: true,
      generated: result.generated.length,
      tickets: result.generated.map((entry) => entry.ticketKey),
      deactivated: result.deactivated.length,
      errors: result.errors,
      embedded: embeddings.embedded,
      embeddingsRemaining: embeddings.remaining,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error('[cron/recurring] sweep failed:', error)
    return NextResponse.json(
      { ok: false, error: 'The sweep failed. Check the server logs.' },
      { status: 500 },
    )
  }
}

/** Length-independent comparison, so the secret cannot be probed by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return mismatch === 0
}
