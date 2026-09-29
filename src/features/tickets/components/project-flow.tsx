import { Hourglass } from 'lucide-react'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import type { ProjectFlow } from '../flow'

/**
 * Where finished work waited. Horizontal bars, one per status, longest first:
 * the long bar is the step to look at.
 */
export function ProjectFlowCard({ flow }: { flow: ProjectFlow }) {
  const max = Math.max(1, ...flow.waits.map((entry) => entry.avgMs))
  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby="flow-card-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="flow-card-heading" className="text-sm font-semibold">
          Where work waits
        </h2>
        <p className="text-xs text-muted-foreground">
          Average time per status · {flow.finished} {flow.finished === 1 ? 'ticket' : 'tickets'} finished in the last 90 days
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Stat label="Median cycle time" value={flow.medianCycle ?? '—'} hint="first start → done" />
        <Stat
          label="Service targets met"
          value={flow.sla ? `${flow.sla.percent}%` : '—'}
          hint={flow.sla ? `${flow.sla.met} of ${flow.sla.targeted}` : 'no targets set'}
        />
        <Stat
          label="Stuck now"
          value={flow.stuckNow === null ? '—' : String(flow.stuckNow)}
          hint={flow.stuckAfter ? `over ${flow.stuckAfter} ${flow.stuckAfter === 1 ? 'day' : 'days'}` : 'flag off'}
          tone={flow.stuckNow ? 'text-amber-600 dark:text-amber-400' : undefined}
        />
      </dl>

      {flow.waits.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Nothing has been finished in the last 90 days yet — this fills in as tickets move to Done.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {flow.waits.map((entry) => (
            <li key={entry.statusId ?? entry.category} className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-2 text-xs">
              <span className="truncate" title={entry.name}>
                {entry.name}
              </span>
              <span className="h-2 rounded-full bg-muted" aria-hidden>
                <span
                  className={cn('block h-2 rounded-full', colorClasses(entry.color).bar)}
                  style={{ width: `${Math.max(2, (entry.avgMs / max) * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-muted-foreground" title={`${entry.tickets} tickets passed through ${entry.name}`}>
                {entry.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {flow.waits.length > 0 && (
        <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Hourglass className="size-3" aria-hidden /> Averages count only the tickets that passed through each status.
        </p>
      )}
    </section>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</dd>
      <dd className="text-[10px] text-muted-foreground">{hint}</dd>
    </div>
  )
}
