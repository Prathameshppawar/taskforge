'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { isTerminal } from '@/core/domain/ticket-rules'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/page-header'
import type { TicketListItem } from '../queries'

/**
 * Month calendar keyed on due date.
 *
 * The grid always renders whole weeks, so the layout does not jump between
 * months with a different number of rows.
 */
export function CalendarView({ tickets }: { tickets: TicketListItem[] }) {
  const [cursor, setCursor] = React.useState(() => new Date())

  const days = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [cursor])

  const byDay = React.useMemo(() => {
    const map = new Map<string, TicketListItem[]>()
    for (const ticket of tickets) {
      if (!ticket.dueDate) continue
      const key = format(ticket.dueDate, 'yyyy-MM-dd')
      const bucket = map.get(key) ?? []
      bucket.push(ticket)
      map.set(key, bucket)
    }
    return map
  }, [tickets])

  const scheduled = tickets.filter((ticket) => ticket.dueDate).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        <h2 className="text-sm font-semibold">{format(cursor, 'MMMM yyyy')}</h2>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => setCursor((date) => subMonths(date, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setCursor(new Date())}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => setCursor((date) => addMonths(date, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          {scheduled} of {tickets.length} tickets have a due date
        </span>
      </div>

      {scheduled === 0 ? (
        <div className="p-4 sm:p-6">
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled"
            description="Tickets appear here once they have a due date."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div
                key={day}
                className="bg-muted/60 px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}

            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const dayTickets = byDay.get(key) ?? []
              const outside = !isSameMonth(day, cursor)

              return (
                <div
                  key={key}
                  className={cn(
                    'min-h-28 bg-card p-1.5 transition-colors',
                    outside && 'bg-muted/30',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        'flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                        isToday(day) && 'bg-primary font-semibold text-primary-foreground',
                        outside && 'text-muted-foreground/60',
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                    {dayTickets.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">
                        {dayTickets.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayTickets.slice(0, 3).map((ticket) => {
                      const overdue =
                        !isTerminal(ticket.status.category) &&
                        ticket.dueDate != null &&
                        ticket.dueDate.getTime() < Date.now() &&
                        !isSameDay(ticket.dueDate, new Date())

                      return (
                        <Link
                          key={ticket.id}
                          href={`/tickets/${ticket.key}`}
                          title={`${ticket.key} — ${ticket.title}`}
                          className={cn(
                            'flex items-center gap-1 rounded px-1 py-0.5 text-[10px] transition-colors',
                            'hover:bg-accent',
                            overdue && 'text-destructive',
                          )}
                        >
                          <span
                            className={cn(
                              'size-1.5 shrink-0 rounded-full',
                              colorClasses(ticket.status.color).dot,
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{ticket.title}</span>
                        </Link>
                      )
                    })}

                    {dayTickets.length > 3 && (
                      <p className="px-1 text-[10px] text-muted-foreground">
                        +{dayTickets.length - 3} more
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
