'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

const INTERVAL_MS = 20_000

/**
 * Refreshes the page when someone else changes the project — polling a tiny
 * version check, only while this tab is visible, and only for projects that
 * turned live updates on. Renders nothing.
 */
export function LiveRefresher({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter()
  const version = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    let stopped = false
    async function check() {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const response = await fetch(`/api/live?project=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
        if (!response.ok) return
        const body = (await response.json()) as { enabled: boolean; version?: string }
        if (!body.enabled) {
          stopped = true
          return
        }
        if (version.current !== null && body.version !== version.current) router.refresh()
        version.current = body.version ?? null
      } catch {
        // Offline for a moment: the next tick will try again.
      }
    }
    void check()
    const timer = window.setInterval(check, INTERVAL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, projectId, router])

  return null
}
