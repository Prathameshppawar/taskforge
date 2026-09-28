import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'

import { normalizeErrorPayload } from '@/core/domain/error-events'
import { ingestError, projectForToken } from '@/features/errors/service'

/**
 * Production error intake: `POST /api/ingest/errors/<secret>`.
 *
 * The secret in the path is the only credential — it is what Sentry's webhook
 * settings, or an app's error handler, can carry. It maps to exactly one
 * project, is stored only as a hash, and can be rotated from project settings.
 * An unknown secret gets the same 404 as a malformed one, so the endpoint
 * cannot be used to probe which secrets exist.
 */
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 256_000

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const project = await projectForToken(token)
  if (!project) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large.' }, { status: 413 })

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
  }

  // Sentry sends a test ping when the webhook is saved; acknowledge it.
  if (typeof body === 'object' && body !== null && (body as { action?: string }).action === 'installation') {
    return NextResponse.json({ ok: true })
  }

  const event = normalizeErrorPayload(body)
  if (!event) {
    return NextResponse.json(
      { error: 'Unrecognised payload. Send a Sentry webhook, or JSON with at least a "message".' },
      { status: 422 },
    )
  }

  const result = await ingestError(project.projectId, event)
  if (result.ticketKey) revalidatePath(`/tickets/${result.ticketKey}`)
  if (result.created) revalidatePath(`/projects/${project.projectId}`, 'layout')
  return NextResponse.json({ ok: true, ...result }, { status: 202 })
}
