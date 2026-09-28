import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'

import { loadCredentials, verifyWebhookSignature } from '@/infrastructure/github/client'
import { handleWebhook } from '@/features/github/service'

/**
 * GitHub webhook receiver.
 *
 * No session and no token: the only credential is the HMAC signature over the
 * raw body, made with the secret GitHub generated for our app. A delivery that
 * does not verify is refused before its JSON is even parsed.
 *
 * Handled events answer 200; everything else answers 202 and is ignored. A
 * failure answers 500 so the delivery shows red in GitHub's log and can be
 * redelivered from there — and the next reconciliation picks it up regardless.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const credentials = await loadCredentials().catch(() => null)
  if (!credentials) {
    return NextResponse.json({ error: 'GitHub is not configured.' }, { status: 503 })
  }

  const raw = await request.text()
  if (!verifyWebhookSignature(raw, request.headers.get('x-hub-signature-256'), credentials.webhookSecret)) {
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event') ?? 'unknown'
  const delivery = request.headers.get('x-github-delivery') ?? '?'

  try {
    const outcome = await handleWebhook(event, JSON.parse(raw))
    for (const key of outcome.tickets) revalidatePath(`/tickets/${key}`)
    if (outcome.tickets.length > 0) revalidatePath('/projects', 'layout')

    return NextResponse.json(
      { ok: true, event, delivery, ...outcome },
      { status: outcome.handled ? 200 : 202 },
    )
  } catch (error) {
    console.error(`[github] webhook ${event} (${delivery}) failed:`, error)
    return NextResponse.json({ ok: false, event, delivery }, { status: 500 })
  }
}
