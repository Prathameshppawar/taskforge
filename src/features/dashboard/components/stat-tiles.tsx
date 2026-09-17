import Link from 'next/link'
import {
  AlertOctagon,
  CircleCheck,
  CircleDot,
  Clock,
  Layers,
  Timer,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { StatCounts } from '../queries'

/**
 * Headline counts.
 *
 * Deliberately not a chart: six single numbers compare badly as bars and read
 * instantly as tiles. Each tile links to the filtered list behind it.
 */
const TILES = [
  { key: 'total', label: 'Total', icon: Layers, href: '', accent: 'text-muted-foreground' },
  { key: 'open', label: 'Open', icon: CircleDot, href: '?category=BACKLOG,TODO', accent: 'text-chart-1' },
  { key: 'inProgress', label: 'In Progress', icon: Timer, href: '?category=IN_PROGRESS,REVIEW', accent: 'text-chart-2' },
  { key: 'blocked', label: 'Blocked', icon: AlertOctagon, href: '?category=BLOCKED', accent: 'text-status-critical' },
  { key: 'done', label: 'Done', icon: CircleCheck, href: '?category=DONE', accent: 'text-status-good' },
  { key: 'overdue', label: 'Overdue', icon: Clock, href: '?overdue=1', accent: 'text-status-critical' },
] as const

export function StatTiles({
  stats,
  basePath,
}: {
  stats: StatCounts
  basePath: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TILES.map((tile) => {
        const Icon = tile.icon
        const value = stats[tile.key]

        return (
          <Link
            key={tile.key}
            href={`${basePath}${tile.href}`}
            className="group rounded-xl border bg-card p-3 transition-all hover:border-foreground/20 hover:shadow-sm"
          >
            <div className="flex items-center gap-1.5">
              <Icon className={cn('size-3.5', tile.accent)} />
              <span className="text-xs text-muted-foreground">{tile.label}</span>
            </div>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
          </Link>
        )
      })}
    </div>
  )
}

/** Hero completion figure with a progress meter. */
export function CompletionCard({
  percent,
  completed,
  countable,
}: {
  percent: number
  completed: number
  countable: number
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">Completion</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums">{percent}%</span>
        <span className="text-xs text-muted-foreground">
          {completed} of {countable} complete
        </span>
      </div>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Completion percentage"
      >
        <div
          className="h-full rounded-full bg-chart-1 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Cancelled tickets are excluded from the denominator.
      </p>
    </div>
  )
}
