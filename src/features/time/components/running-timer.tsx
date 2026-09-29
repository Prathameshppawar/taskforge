'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Square } from 'lucide-react'
import { toast } from 'sonner'

import { formatMinutes } from '@/core/domain/time'
import { stopTimerAction } from '../actions'

/**
 * The running timer, in the header on every page: the ticket it is on, how
 * long it has run, and Stop. Absent when nothing is running.
 */
export function RunningTimer({ timer }: { timer: { startedAt: Date; ticket: { key: string; title: string } } | null }) {
  const router = useRouter()
  const [now, setNow] = React.useState(() => Date.now())
  const [busy, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!timer) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [timer])

  if (!timer) return null
  const minutes = Math.max(0, Math.round((now - new Date(timer.startedAt).getTime()) / 60_000))

  return (
    <div className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 py-0.5 pr-0.5 pl-2.5 text-xs">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <Link href={`/tickets/${timer.ticket.key}`} className="font-mono hover:underline" title={timer.ticket.title}>
        {timer.ticket.key}
      </Link>
      <span className="tabular-nums text-muted-foreground" suppressHydrationWarning>
        {formatMinutes(minutes)}
      </span>
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            const result = await stopTimerAction()
            if (!result.success) toast.error(result.error)
            else {
              if (result.data) toast.success(`Logged ${formatMinutes(result.data.minutes)} on ${result.data.ticketKey}.`)
              router.refresh()
            }
          })
        }
        disabled={busy}
        className="ml-0.5 rounded-full p-1 hover:bg-emerald-500/20"
        aria-label={`Stop the timer on ${timer.ticket.key}`}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
      </button>
    </div>
  )
}
