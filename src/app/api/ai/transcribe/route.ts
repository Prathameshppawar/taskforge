import { NextResponse, type NextRequest } from 'next/server'

import { getCurrentUser } from '@/features/auth/guards'
import { roleHas } from '@/core/domain/rbac'
import { env, isAiEnabled } from '@/lib/env'

/**
 * Speech-to-text fallback.
 *
 * The browser's own SpeechRecognition is used when it exists — it is free,
 * needs no round-trip and streams interim results. This route covers the
 * browsers that lack it (Firefox, and any Chromium build without the service),
 * using Groq's Whisper.
 *
 * Whisper sits on a separate quota from chat completions — 2,000 requests a day
 * on the free tier — so dictating does not eat into the Copilot's budget.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Whisper's own ceiling is far higher; this bounds abuse, not capability. */
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(request: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  // Dictation is part of the Copilot, so it carries the same permission.
  if (!roleHas(actor.role, 'ai:use')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  if (!isAiEnabled() || env().AI_PROVIDER !== 'groq' || !env().GROQ_API_KEY) {
    return NextResponse.json(
      { error: 'Transcription needs AI_PROVIDER=groq and a GROQ_API_KEY.' },
      { status: 503 },
    )
  }

  let audio: File | null = null
  try {
    const form = await request.formData()
    const value = form.get('audio')
    if (value instanceof File) audio = value
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 })
  }

  if (!audio) {
    return NextResponse.json({ error: 'No audio supplied.' }, { status: 400 })
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: 'The recording was empty.' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'That recording is too long. Keep it under about two minutes.' },
      { status: 413 },
    )
  }

  const upstream = new FormData()
  upstream.append('file', audio, 'speech.webm')
  // The turbo model is materially faster and accurate enough for dictation,
  // which is being read back and edited before it is sent anyway.
  upstream.append('model', 'whisper-large-v3-turbo')
  upstream.append('response_format', 'json')
  upstream.append('temperature', '0')

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env().GROQ_API_KEY}` },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 429) {
        return NextResponse.json(
          { error: 'Transcription rate limit reached. Try again shortly.' },
          { status: 429 },
        )
      }
      console.error('[transcribe] groq error', response.status, detail.slice(0, 200))
      return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 })
    }

    const payload = (await response.json()) as { text?: string }
    return NextResponse.json({ text: (payload.text ?? '').trim() })
  } catch (error) {
    console.error('[transcribe] failed:', error)
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 })
  }
}
