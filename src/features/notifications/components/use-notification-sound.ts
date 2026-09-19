'use client'

import * as React from 'react'

const STORAGE_KEY = 'taskforge:notification-sound'

/**
 * The notification chime.
 *
 * Synthesised with the Web Audio API rather than loaded from a file. A short
 * chime is a handful of oscillator settings, so shipping one as an asset would
 * add a binary to the repository and a network request to every page load to
 * deliver about a hundred bytes of actual information.
 *
 * Two notes rather than one: a single beep reads as an error in most software,
 * a rising pair reads as "something arrived".
 */
const NOTES = [
  { frequency: 880, at: 0 },      // A5
  { frequency: 1318.51, at: 0.09 }, // E6
]

/** Quiet on purpose. This fires while someone is working, not to summon them. */
const PEAK_GAIN = 0.12
const NOTE_SECONDS = 0.22

export function useNotificationSound() {
  const [enabled, setEnabled] = React.useState(true)
  const contextRef = React.useRef<AudioContext | null>(null)

  // Read after mount, never during render: the server has no localStorage, so
  // reading it during render would make the markup mismatch and hydrate wrong.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setEnabled(stored === 'on')
    } catch {
      // Private browsing or blocked site data — the default stands.
    }
  }, [])

  const toggle = React.useCallback(() => {
    setEnabled((previous) => {
      const next = !previous
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      } catch {
        // Preference simply will not survive a reload.
      }
      return next
    })
  }, [])

  const play = React.useCallback(() => {
    if (!enabled || typeof window === 'undefined') return

    try {
      // Created on demand and reused. Browsers cap how many contexts a page may
      // open, so one per chime would eventually stop producing sound.
      let context = contextRef.current
      if (!context || context.state === 'closed') {
        context = new AudioContext()
        contextRef.current = context
      }

      // Autoplay policy: a context created before the user has interacted with
      // the page starts suspended. Resuming is a no-op once they have clicked
      // anything, and rejects harmlessly before that — so an early notification
      // is silent rather than throwing.
      void context.resume().catch(() => {})

      const start = context.currentTime

      for (const note of NOTES) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()

        oscillator.type = 'sine'
        oscillator.frequency.value = note.frequency

        // An exponential fall, which is what a struck object does. A linear
        // ramp sounds synthetic, and cutting the gain outright clicks.
        const noteStart = start + note.at
        gain.gain.setValueAtTime(0.0001, noteStart)
        gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, noteStart + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + NOTE_SECONDS)

        oscillator.connect(gain).connect(context.destination)
        oscillator.start(noteStart)
        oscillator.stop(noteStart + NOTE_SECONDS)
      }
    } catch {
      // No Web Audio support, or the context was refused. The badge still
      // updates; sound is an enhancement, never the notification itself.
    }
  }, [enabled])

  // Release the audio hardware when the bell unmounts.
  React.useEffect(() => {
    return () => {
      void contextRef.current?.close().catch(() => {})
      contextRef.current = null
    }
  }, [])

  return { enabled, toggle, play }
}
