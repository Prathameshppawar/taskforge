'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  addDays,
  differenceInCalendarDays,
  eachWeekOfInterval,
  endOfDay,
  format,
  max as maxDate,
  min as minDate,
  startOfDay,
} from 'date-fns'
import { GanttChartSquare } from 'lucide-react'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { isTerminal } from '@/core/domain/ticket-rules'
import { EmptyState } from '@/components/shared/page-header'
import { UserAvatar } from '@/components/shared/user-avatar'
import type { TicketListItem } from '../queries'

const DAY_WIDTH = 28
const ROW_HEIGHT = 34

/**
 * Roadmap-style timeline.
 *
 * Each ticket becomes a bar spanning startDate → dueDate. Tickets with only a
 * due date get a short lead-in so they remain visible; tickets with neither are
 * listed separately rather than silently dropped.
 */
export function TimelineView({ tickets }: { tickets: TicketListItem[] }) {
  const scheduled = React.useMemo(
    () => tickets.filter((ticket) => ticket.dueDate || ticket.startDate),
    [tickets],
  )
  const unscheduled = React.useMemo(
    () => tickets.filter((ticket) => !ticket.dueDate && !ticket.startDate),
    [tickets],
  )

  const range = React.useMemo(() => {
    if (scheduled.length === 0) return null

    const dates: Date[] = []
    for (const ticket of scheduled) {
      if (ticket.startDate) dates.push(ticket.startDate)
      if (ticket.dueDate) dates.push(ticket.dueDate)
    }

    // Pad the window so bars never touch the edges.
    const start = startOfDay(addDays(minDate(dates), -3))
    const end = endOfDay(addDays(maxDate(dates), 5))
    return { start, end, days: differenceInCalendarDays(end, start) + 1 }
  }, [scheduled])

  if (!range) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={GanttChartSquare}
          title="Nothing to plot"
          description="Give tickets a start or due date and they will appear on the roadmap."
        />
      </div>
    )
  }

  const weeks = eachWeekOfInterval(
    { start: range.start, end: range.end },
    { weekStartsOn: 1 },
  )
  const today = startOfDay(new Date())
  const todayOffset = differenceInCalendarDays(today, range.start)

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-fit p-4 sm:p-6">
        <div className="flex">
          {/* Fixed label column */}
          <div className="sticky left-0 z-10 w-56 shrink-0 bg-background">
            <div className="h-9 border-b" />
            {scheduled.map((ticket) => (
              <div
                key={ticket.id}
                style={{ height: ROW_HEIGHT }}
                className="flex items-center gap-2 border-b pr-3"
              >
                <Link
                  href={`/tickets/${ticket.key}`}
                  className="shrink-0 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {ticket.key}
                </Link>
                <Link
                  href={`/tickets/${ticket.key}`}
                  className="min-w-0 flex-1 truncate text-xs hover:underline"
                  title={ticket.title}
                >
                  {ticket.title}
                </Link>
              </div>
            ))}
          </div>

          {/* Scrollable grid */}
          <div className="relative" style={{ width: range.days * DAY_WIDTH }}>
            {/* Week header */}
            <div className="flex h-9 border-b">
              {weeks.map((week) => {
                const offset = differenceInCalendarDays(week, range.start)
                if (offset < 0) return null
                return (
                  <div
                    key={week.toISOString()}
                    style={{
                      position: 'absolute',
                      left: offset * DAY_WIDTH,
                      width: 7 * DAY_WIDTH,
                    }}
                    className="flex h-9 items-center border-l px-2 text-[10px] text-muted-foreground"
                  >
                    {format(week, 'd MMM')}
                  </div>
                )
              })}
            </div>

            {/* Today marker */}
            {todayOffset >= 0 && todayOffset < range.days && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary"
                style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }}
                aria-hidden
              >
                <span className="absolute -top-0.5 -left-1 size-2 rounded-full bg-primary" />
              </div>
            )}

            {/* Bars */}
            {scheduled.map((ticket) => {
              const start = ticket.startDate ?? addDays(ticket.dueDate!, -2)
              const end = ticket.dueDate ?? addDays(ticket.startDate!, 2)

              const offset = Math.max(0, differenceInCalendarDays(start, range.start))
              const span = Math.max(1, differenceInCalendarDays(end, start) + 1)
              const done = isTerminal(ticket.status.category)
              const overdue = !done && ticket.dueDate && ticket.dueDate < today

              return (
                <div
                  key={ticket.id}
                  style={{ height: ROW_HEIGHT }}
                  className="relative border-b"
                >
                  <Link
                    href={`/tickets/${ticket.key}`}
                    style={{ left: offset * DAY_WIDTH, width: span * DAY_WIDTH - 4 }}
                    className={cn(
                      'absolute top-1.5 flex h-6 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-white transition-all',
                      'hover:brightness-110',
                      colorClasses(ticket.status.color).dot,
                      done && 'opacity-60',
                      overdue && 'ring-2 ring-destructive ring-offset-1 ring-offset-background',
                    )}
                    title={`${ticket.key} — ${ticket.title}\n${format(start, 'd MMM')} → ${format(end, 'd MMM')}`}
                  >
                    <span className="truncate">{ticket.title}</span>
                    {ticket.assignee && (
                      <span className="ml-auto shrink-0">
                        <UserAvatar
                          name={ticket.assignee.name}
                          color={ticket.assignee.avatarColor}
                          size="xs"
                        />
                      </span>
                    )}
                  </Link>
                </div>
              )
            })}
          </div>
        </div>

        {unscheduled.length > 0 && (
          <div className="mt-6 rounded-lg border border-dashed p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {unscheduled.length} unscheduled{' '}
              {unscheduled.length === 1 ? 'ticket' : 'tickets'} — no start or due date
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unscheduled.slice(0, 20).map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.key}`}
                  className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {ticket.key}
                </Link>
              ))}
              {unscheduled.length > 20 && (
                <span className="text-[10px] text-muted-foreground">
                  +{unscheduled.length - 20}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
