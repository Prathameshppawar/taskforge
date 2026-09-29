import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'

import { getProjectViewContext } from '@/features/projects/project-context'
import { getCycleDetail } from '@/features/cycles/queries'
import { BurnupChart } from '@/features/cycles/components/burnup-chart'
import { forecastCycle } from '@/features/forecast/queries'
import { ForecastLine } from '@/features/forecast/components/forecast-line'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { PriorityBadge, StatusBadge } from '@/components/shared/badges'

export const metadata: Metadata = { title: 'Cycle' }

export default async function CyclePage({ params }: { params: Promise<{ projectId: string; cycleId: string }> }) {
  const { projectId, cycleId } = await params
  const context = await getProjectViewContext(projectId)
  const detail = await getCycleDetail(context.actor, cycleId)
  if (!detail || detail.cycle.projectId !== projectId) notFound()

  const { cycle, series, unit, tickets } = detail
  const forecast = await forecastCycle(cycle.id)
  const last = series.at(-1)
  const summary = (cycle.summary ?? null) as { completed?: number; carried?: number; carriedTo?: string; carriedKeys?: string[] } | null
  const added = series.length > 1 ? Math.max(0, (last?.scope ?? 0) - series[0].scope) : 0
  const idealEnd = cycle.endDate ? { day: format(cycle.endDate, 'yyyy-MM-dd'), value: last?.scope ?? 0 } : null

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {cycle.name}
            <Badge variant="outline" className="text-[10px]">{cycle.kind === 'SPRINT' ? 'Sprint' : 'Milestone'}</Badge>
            <Badge variant="secondary" className="text-[10px]">{cycle.state.toLowerCase()}</Badge>
          </span>
        }
        description={cycle.goal ?? undefined}
      />
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Link href={`/projects/${projectId}/plan`} className="text-xs text-muted-foreground hover:text-foreground">
          ← Plan
        </Link>

        <ForecastLine forecast={forecast} dueDate={cycle.endDate} className="rounded-lg border bg-card px-3 py-2" />

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Dates" value={`${cycle.startDate ? format(cycle.startDate, 'd MMM') : '…'} → ${cycle.endDate ? format(cycle.endDate, 'd MMM') : '…'}`} />
          <Stat label={`Done (${unit})`} value={`${last?.done ?? 0} / ${last?.scope ?? 0}`} />
          <Stat label="Added since start" value={`${added} ${unit}`} tone={added > 0 ? 'text-amber-600 dark:text-amber-400' : undefined} />
          <Stat label="Capacity" value={cycle.capacity ? `${cycle.capacity} ${unit}` : 'not set'} />
        </dl>

        <figure className="rounded-xl border bg-card p-4">
          <figcaption className="mb-2">
            <h2 className="text-sm font-medium">Burn-up</h2>
            <p className="text-xs text-muted-foreground">
              What was in the cycle and what was done at the end of each day, from the recorded history — scope added mid-cycle shows as the top line rising.
            </p>
          </figcaption>
          {series.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">The chart starts on the cycle’s first day.</p>
          ) : (
            <BurnupChart series={series} unit={unit} ideal={idealEnd} />
          )}
        </figure>

        {summary && (
          <p className="rounded-lg bg-muted/40 p-3 text-sm">
            Closed with {summary.completed ?? 0} done
            {summary.carried ? `; ${summary.carried} carried to ${summary.carriedTo}: ${(summary.carriedKeys ?? []).join(', ')}` : '.'}
          </p>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">In this {cycle.kind === 'SPRINT' ? 'sprint' : 'milestone'} now</h2>
          <ul className="divide-y rounded-xl border">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-2 p-2 text-sm">
                <Link href={`/tickets/${ticket.key}`} className="font-mono text-[11px] text-muted-foreground hover:underline">
                  {ticket.key}
                </Link>
                <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                <StatusBadge name={ticket.status.name} color={ticket.status.color} />
                <PriorityBadge name={ticket.priority.name} color={ticket.priority.color} level={ticket.priority.level} showLabel={false} />
                <span className="w-6 text-right text-[11px] tabular-nums text-muted-foreground">{ticket.storyPoints ?? '–'}</span>
              </li>
            ))}
            {tickets.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">Nothing is in it right now.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}
