import Link from 'next/link'

import { TICKET_KIND_LABELS } from '@/core/domain/git-refs'
import { decimalHours, formatMinutes } from '@/core/domain/time'
import type { TicketKind } from '@prisma/client'
import type { ProjectTime } from '../queries'

/** This month's time on a project: who, on what kind of work, and billable. */
export function ProjectTimeCard({ time, monthLabel }: { time: ProjectTime; monthLabel: string }) {
  const max = Math.max(1, ...time.people.map((person) => person.minutes))
  const money = (value: number) => new Intl.NumberFormat('en', { style: 'currency', currency: time.currency }).format(value)
  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby="time-card-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="time-card-heading" className="text-sm font-semibold">Time · {monthLabel}</h2>
        <p className="text-xs text-muted-foreground">
          {decimalHours(time.total)} h logged · {decimalHours(time.billable)} h billable
          {time.amount !== null ? ` · ${money(time.amount)}` : ''}
        </p>
      </div>
      {time.total === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No time logged this month. Anyone working a ticket can start a timer from its sidebar.</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ul className="space-y-1.5" aria-label="By person">
            {time.people.map((person) => (
              <li key={person.id} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-2 text-xs">
                <span className="truncate">{person.name}</span>
                <span className="h-2 rounded-full bg-muted" aria-hidden>
                  <span className="block h-2 rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(2, (person.minutes / max) * 100)}%` }} />
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{formatMinutes(person.minutes)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 text-xs">
            <p className="font-medium text-muted-foreground">By kind of work</p>
            <ul className="space-y-0.5">
              {time.kinds.map((entry) => (
                <li key={entry.kind} className="flex justify-between gap-2">
                  <span>{TICKET_KIND_LABELS[entry.kind as TicketKind]?.label ?? entry.kind}</span>
                  <span className="tabular-nums text-muted-foreground">{formatMinutes(entry.minutes)}</span>
                </li>
              ))}
            </ul>
            <p className="pt-1 font-medium text-muted-foreground">Most time</p>
            <ul className="space-y-0.5">
              {time.tickets.slice(0, 5).map((ticket) => (
                <li key={ticket.key} className="flex justify-between gap-2">
                  <Link href={`/tickets/${ticket.key}`} className="min-w-0 truncate hover:underline">
                    <span className="font-mono text-[11px] text-muted-foreground">{ticket.key}</span> {ticket.title}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatMinutes(ticket.minutes)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
