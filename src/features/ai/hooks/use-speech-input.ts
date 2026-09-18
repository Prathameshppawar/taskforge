'use client'

import * as React from 'react'

/**
 * Dictation for the Copilot input.
 *
 * Two engines, chosen at runtime:
 *
 *   • The browser's own SpeechRecognition where it exists (Chrome, Edge,
 *     Safari). Free, no round-trip, and it streams interim text so the user can
 *     see it working — which matters, because silence during recording reads as
 *     "broken".
 *   • Otherwise MediaRecorder plus Groq Whisper (Firefox, and Chromium builds
 *     without the service). Batch rather than live, but universal.
 *
 * Neither costs anything. Whisper is on a separate quota from chat completions,
 * so dictating never eats the Copilot's token budget.
 */

type Engine = 'native' | 'whisper' | 'none'

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function nativeRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export interface SpeechInput {
  supported: boolean
  engine: Engine
  listening: boolean
  /** Live partial text while speaking. Empty on the Whisper path. */
  interim: string
  busy: boolean
  error: string | null
  start: () => void
  stop: () => void
}

export function useSpeechInput(onText: (text: string) => void): SpeechInput {
  const [engine, setEngine] = React.useState<Engine>('none')
  const [listening, setListening] = React.useState(false)
  const [interim, setInterim] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  // Keep the callback in a ref so starting is not tied to its identity.
  const onTextRef = React.useRef(onText)
  React.useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  React.useEffect(() => {
    if (nativeRecognition()) setEngine('native')
    else if (typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined') {
      setEngine('whisper')
    } else setEngine('none')
  }, [])

  // Release the microphone if the panel unmounts mid-recording.
  React.useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const startNative = React.useCallback(() => {
    const recognition = nativeRecognition()
    if (!recognition) return

    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    let finalText = ''

    recognition.onresult = (event) => {
      let live = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += text
        else live += text
      }
      setInterim(live)
      if (finalText) {
        onTextRef.current(finalText.trim())
        finalText = ''
      }
    }

    recognition.onerror = (event) => {
      setError(
        event.error === 'not-allowed'
          ? 'Microphone access was denied. Allow it in your browser settings.'
          : event.error === 'no-speech'
            ? null // Not worth surfacing — the user simply paused.
            : 'Dictation failed. Try again.',
      )
      setListening(false)
      setInterim('')
    }

    recognition.onend = () => {
      setListening(false)
      setInterim('')
    }

    recognitionRef.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }, [])

  const startWhisper = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setListening(false)

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size === 0) return

        setBusy(true)
        try {
          const form = new FormData()
          form.append('audio', blob, 'speech.webm')
          const response = await fetch('/api/ai/transcribe', { method: 'POST', body: form })
          const payload = (await response.json()) as { text?: string; error?: string }

          if (!response.ok) setError(payload.error ?? 'Transcription failed.')
          else if (payload.text) onTextRef.current(payload.text)
        } catch {
          setError('Transcription failed.')
        } finally {
          setBusy(false)
        }
      }

      recorderRef.current = recorder
      setError(null)
      setListening(true)
      recorder.start()
    } catch {
      setError('Microphone access was denied. Allow it in your browser settings.')
    }
  }, [])

  const start = React.useCallback(() => {
    if (listening || busy) return
    if (engine === 'native') startNative()
    else if (engine === 'whisper') void startWhisper()
  }, [engine, listening, busy, startNative, startWhisper])

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    setListening(false)
  }, [])

  return { supported: engine !== 'none', engine, listening, interim, busy, error, start, stop }
}
