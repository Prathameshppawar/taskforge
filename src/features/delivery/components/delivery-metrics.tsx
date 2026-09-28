import { Gauge } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatSpan, type DoraBand } from '@/core/domain/dora'
import type { DeliveryMetrics as Metrics } from '../queries'

/**
 * DORA delivery metrics. Each tile shows the figure, the band as a word, and
 * what it was computed from — the band is never carried by colour alone.
 */
const BAND: Record<DoraBand, { label: string; className: string }> = {
  elite: { label: 'Elite', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  high: { label: 'High', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  medium: { label: 'Medium', className: 'bg-amber-500/10 text-amber-800 dark:text-amber-400' },
  low: { label: 'Low', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
}

function Tile({ label, value, band, basis }: { label: string; value: string; band: DoraBand | null; basis: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {band ? (
          <span className={cn('rounded px-1.5 py-px text-[10px] font-medium', BAND[band].className)}>{BAND[band].label}</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">not enough data</span>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{basis}</p>
    </div>
  )
}

export function DeliveryMetrics({ metrics }: { metrics: Metrics }) {
  const max = Math.max(1, ...metrics.weeks.map((week) => week.count))
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Gauge className="size-4 text-muted-foreground" />
          Delivery (DORA, last {metrics.days} days)
        </h2>
        <p className="text-xs text-muted-foreground">
          {metrics.hasRepos
            ? 'From production deployments, when each shipped change first appeared in git, and Production tickets.'
            : 'Link a repository in project settings to measure delivery.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Deployment frequency"
          value={metrics.deployments ? `${Math.round(metrics.frequency.perWeek * 10) / 10}/week` : '—'}
          band={metrics.frequency.band}
          basis={`${metrics.deployments} production deploys`}
        />
        <Tile
          label="Lead time for changes"
          value={formatSpan(metrics.leadTime.ms)}
          band={metrics.leadTime.band}
          basis={`median of ${metrics.leadTime.samples} shipped changes`}
        />
        <Tile
          label="Change failure rate"
          value={metrics.failureRate.rate === null ? '—' : `${Math.round(metrics.failureRate.rate * 100)}%`}
          band={metrics.failureRate.band}
          basis="deploys followed by a production issue within 24 h"
        />
        <Tile
          label="Time to restore"
          value={formatSpan(metrics.recovery.ms)}
          band={metrics.recovery.band}
          basis={`median of ${metrics.recovery.resolved} resolved production issues`}
        />
      </div>
      {metrics.deployments > 0 && (
        <table className="w-full text-xs">
          <caption className="pb-1 text-left text-muted-foreground">Production deploys per week</caption>
          <tbody>
            {metrics.weeks.map((week) => (
              <tr key={week.start.toISOString()} className="border-t">
                <td className="w-24 py-1 text-muted-foreground tabular-nums">{week.start.toISOString().slice(5, 10)}</td>
                <td className="py-1">
                  <span className="block h-1.5 rounded-full bg-muted">
                    <span className="block h-1.5 rounded-full bg-primary/70" style={{ width: `${(week.count / max) * 100}%` }} />
                  </span>
                </td>
                <td className="w-10 py-1 text-right tabular-nums">{week.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
