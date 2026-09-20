'use client'

import * as React from 'react'

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

/**
 * Plays the chime, unconditionally.
 *
 * Deliberately knows nothing about whether the person wants to hear it: the
 * settings screen has a "play it for me" button that must work *while the
 * preference is off*, because the whole point of that button is to let someone
 * hear what they are about to switch on.
 */
export function useNotificationChime() {
  const contextRef = React.useRef<AudioContext | null>(null)

  const play = React.useCallback(() => {
    if (typeof window === 'undefined') return

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
  }, [])

  // Release the audio hardware when the owner unmounts.
  React.useEffect(() => {
    return () => {
      void contextRef.current?.close().catch(() => {})
      contextRef.current = null
    }
  }, [])

  return play
}

/**
 * The chime, gated on the person's saved preference.
 *
 * `enabled` arrives from the server — it is a column on the user, not browser
 * storage, so muting on a laptop also mutes on a phone. That means this hook
 * holds no preference state of its own: the value changes by the server
 * re-rendering the layout, never by this hook deciding anything.
 */
export function useNotificationSound(enabled: boolean) {
  const chime = useNotificationChime()

  return React.useCallback(() => {
    if (enabled) chime()
  }, [enabled, chime])
}
