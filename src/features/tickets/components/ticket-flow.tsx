import { Clock3, PauseCircle, Timer, TimerOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { formatDuration, type Clock } from '@/core/domain/flow'
import type { TicketFlow } from '../flow'

/**
 * The ticket's clocks and where its time went. Server-rendered from the
 * status history; a refresh is all it needs to stay current.
 */
export function TicketFlowPanel({ flow }: { flow: TicketFlow }) {
  const max = Math.max(1, ...flow.time.map((entry) => entry.ms))
  return (
    <div className="space-y-3 text-xs">
      {flow.sla && (
        <div className="space-y-1.5">
          <p className="font-medium text-muted-foreground">Service targets · {flow.sla.priority}</p>
          {flow.sla.respond && <ClockRow label="First response" clock={flow.sla.respond} />}
          {flow.sla.resolve && <ClockRow label="Resolution" clock={flow.sla.resolve} />}
        </div>
      )}

      {flow.time.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 font-medium text-muted-foreground">
            <Clock3 className="size-3" /> Time in status
          </p>
          <ul className="space-y-1">
            {flow.time.map((entry) => (
              <li key={entry.statusId ?? entry.category} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{entry.label}</span>
                </div>
                <div className="h-1 rounded-full bg-muted">
                  <div
                    className={cn('h-1 rounded-full', colorClasses(entry.color).bar)}
                    style={{ width: `${Math.max(3, (entry.ms / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const STATE: Record<Clock['state'], { text: string; tone: string; icon: React.ElementType }> = {
  running: { text: 'left', tone: 'text-foreground', icon: Timer },
  at_risk: { text: 'left', tone: 'text-amber-600 dark:text-amber-400', icon: Timer },
  breached: { text: 'over', tone: 'text-destructive', icon: TimerOff },
  paused: { text: 'left · paused while blocked', tone: 'text-muted-foreground', icon: PauseCircle },
  met: { text: 'met', tone: 'text-emerald-600 dark:text-emerald-400', icon: Timer },
  met_late: { text: 'met late', tone: 'text-destructive', icon: TimerOff },
}

function ClockRow({ label, clock }: { label: string; clock: Clock }) {
  const meta = STATE[clock.state]
  const remaining = clock.budgetMs - clock.spentMs
  const detail =
    clock.state === 'met' || clock.state === 'met_late'
      ? `${meta.text} in ${formatDuration(clock.spentMs)}`
      : clock.state === 'breached'
        ? `${formatDuration(-remaining)} ${meta.text}`
        : `${formatDuration(remaining)} ${meta.text}`
  const share = Math.min(1, clock.spentMs / clock.budgetMs)
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          <meta.icon className={cn('size-3', meta.tone)} aria-hidden />
          {label}
          <span className="text-muted-foreground">({formatDuration(clock.budgetMs)})</span>
        </span>
        <span className={cn('shrink-0 font-medium tabular-nums', meta.tone)}>{detail}</span>
      </div>
      <div
        className="h-1 rounded-full bg-muted"
        role="meter"
        aria-label={`${label}: ${detail}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div
          className={cn(
            'h-1 rounded-full',
            clock.state === 'breached' || clock.state === 'met_late'
              ? 'bg-destructive'
              : clock.state === 'at_risk'
                ? 'bg-amber-500'
                : clock.state === 'met'
                  ? 'bg-emerald-500'
                  : 'bg-primary',
          )}
          style={{ width: `${Math.max(3, share * 100)}%` }}
        />
      </div>
      {!clock.stoppedAt && clock.state !== 'paused' && (
        <p className="text-[11px] text-muted-foreground">
          due {clock.dueAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}
    </div>
  )
}
