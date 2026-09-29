'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Clock, Loader2, Play, Plus, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { formatMinutes, parseDuration } from '@/core/domain/time'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/shared/date-picker'
import { deleteTimeEntryAction, logTimeAction, startTimerAction, stopTimerAction } from '../actions'
import type { TicketTime } from '../queries'

/**
 * Time on this ticket: the timer, a quick "log time", and what has been
 * logged, with the estimate beside it when there is one.
 */
export function TicketTimePanel({
  ticketId,
  time,
  estimateHours,
  canLog,
  viewerId,
}: {
  ticketId: string
  time: TicketTime
  estimateHours: number | null
  canLog: boolean
  viewerId: string
}) {
  const router = useRouter()
  const [busy, startTransition] = React.useTransition()
  const [open, setOpen] = React.useState(false)
  const [duration, setDuration] = React.useState('')
  const [date, setDate] = React.useState<Date | null>(null)
  const [note, setNote] = React.useState('')
  const [billable, setBillable] = React.useState(true)
  const [now, setNow] = React.useState(() => Date.now())

  const running = time.running
  React.useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [running])

  const parsed = duration.trim() ? parseDuration(duration) : null
  const runningMinutes = running ? Math.max(0, Math.round((now - new Date(running.startedAt).getTime()) / 60_000)) : 0
  const estimateMinutes = estimateHours ? estimateHours * 60 : null

  if (!canLog && time.total === 0) return null

  function toggleTimer() {
    startTransition(async () => {
      const result = running ? await stopTimerAction() : await startTimerAction(ticketId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (running && result.data && 'minutes' in result.data) toast.success(`Logged ${formatMinutes(result.data.minutes)}.`)
      if (!running && result.data && 'stopped' in result.data && result.data.stopped) toast.message(`Stopped the other timer: ${result.data.stopped}.`)
      router.refresh()
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!parsed) return
    startTransition(async () => {
      const result = await logTimeAction({ ticketId, duration, date: date ?? undefined, note: note || undefined, billable })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Logged ${formatMinutes(result.data.minutes)}.`)
      setDuration('')
      setNote('')
      setDate(null)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 font-medium text-muted-foreground">
          <Clock className="size-3" /> Time
        </p>
        <span className="tabular-nums text-muted-foreground">
          {formatMinutes(time.total)}
          {estimateMinutes ? ` of ${formatMinutes(estimateMinutes)} est.` : ''}
        </span>
      </div>

      {estimateMinutes ? (
        <div className="h-1 rounded-full bg-muted" aria-hidden>
          <div
            className={cn('h-1 rounded-full', time.total > estimateMinutes ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${Math.min(100, Math.max(3, (time.total / estimateMinutes) * 100))}%` }}
          />
        </div>
      ) : null}

      {canLog && (
        <div className="flex gap-1.5">
          <Button size="sm" variant={running ? 'destructive' : 'outline'} className="h-7 flex-1 text-xs" onClick={toggleTimer} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            {running ? `Stop · ${formatMinutes(runningMinutes)}` : 'Start timer'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <Plus className="size-3.5" /> Log
          </Button>
        </div>
      )}

      {open && canLog && (
        <form onSubmit={submit} className="space-y-1.5 rounded-lg border p-2">
          <Input
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            placeholder="1h 30m, 45m, 1.5h"
            aria-label="Duration"
            aria-invalid={duration.trim() !== '' && !parsed}
            className="h-8 text-xs"
            autoFocus
          />
          {duration.trim() && (
            <p className={cn('text-[11px]', parsed ? 'text-muted-foreground' : 'text-destructive')}>
              {parsed ? `= ${formatMinutes(parsed)}` : 'Not a duration I can read.'}
            </p>
          )}
          <DatePicker value={date} onChange={setDate} placeholder="Today" />
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was done (optional)" aria-label="Note" className="h-8 text-xs" />
          <label className="flex items-center gap-1.5">
            <Checkbox checked={billable} onCheckedChange={(value) => setBillable(value === true)} />
            Billable
          </label>
          <Button type="submit" size="sm" className="h-7 w-full text-xs" disabled={!parsed || busy}>
            Log {parsed ? formatMinutes(parsed) : 'time'}
          </Button>
        </form>
      )}

      {time.people.length > 0 && (
        <ul className="space-y-0.5">
          {time.people.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{person.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatMinutes(person.minutes)}</span>
            </li>
          ))}
          {time.billable !== time.total && (
            <li className="flex items-center justify-between gap-2 text-muted-foreground">
              <span>Billable</span>
              <span className="tabular-nums">{formatMinutes(time.billable)}</span>
            </li>
          )}
        </ul>
      )}

      {time.entries.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Entries</summary>
          <ul className="mt-1 space-y-1">
            {time.entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-1.5">
                <span className="w-12 shrink-0 tabular-nums">{entry.endedAt ? formatMinutes(entry.counted) : 'running'}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {entry.user?.name ?? 'Former member'} · {format(new Date(entry.startedAt), 'd MMM')}
                  {!entry.billable && ' · not billable'}
                  {entry.note && <span className="block truncate text-foreground">{entry.note}</span>}
                </span>
                {entry.user?.id === viewerId && entry.endedAt && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove this entry"
                    onClick={() =>
                      startTransition(async () => {
                        const result = await deleteTimeEntryAction(entry.id)
                        if (!result.success) toast.error(result.error)
                        else router.refresh()
                      })
                    }
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
