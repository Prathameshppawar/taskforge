import Link from 'next/link'
import { History } from 'lucide-react'

import type { HistoricalEstimate as Estimate } from '../estimates'

/**
 * What comparable work actually took.
 *
 * Renders nothing when the project has not finished enough similar tickets —
 * an estimate from two samples is an anecdote, and showing it with the same
 * confidence as one from twenty is how people learn to distrust the number.
 *
 * The evidence sits beside the figure on purpose: "6 days" is a guess until you
 * can see which three tickets it came from.
 */
export function HistoricalEstimate({ estimate }: { estimate: Estimate | null }) {
  if (!estimate) return null

  const { medianDays, fastestDays, slowestDays, sampleSize, comparable } = estimate
  const spread = fastestDays === slowestDays ? null : `${fastestDays}–${slowestDays} days`

  return (
    <section className="rounded-lg border bg-muted/30 p-3">
      <h2 className="flex items-center gap-1.5 text-xs font-medium">
        <History className="size-3.5 text-muted-foreground" />
        Similar work took
      </h2>

      <p className="mt-1 text-sm">
        <span className="font-medium">
          {medianDays} {medianDays === 1 ? 'day' : 'days'}
        </span>{' '}
        <span className="text-xs text-muted-foreground">
          typically{spread ? `, ranging ${spread}` : ''} · {sampleSize} finished{' '}
          {sampleSize === 1 ? 'ticket' : 'tickets'}
        </span>
      </p>

      <ul className="mt-1.5 space-y-0.5">
        {comparable.map((entry) => (
          <li key={entry.key} className="flex items-baseline gap-1.5 text-[11px]">
            <Link
              href={`/tickets/${entry.key}`}
              className="shrink-0 font-mono text-primary hover:underline"
            >
              {entry.key}
            </Link>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {entry.days}d
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
