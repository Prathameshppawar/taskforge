import type { Metadata } from 'next'
import Link from 'next/link'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { getTimesheet } from '@/features/time/queries'
import { decimalHours, formatMinutes } from '@/core/domain/time'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Timesheet' }

/**
 * Your week: a row per ticket, a column per day. Read-only on purpose — time
 * is logged on the ticket it belongs to, where the work is — and every row
 * links back there.
 */
export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const actor = await requireUser()
  const { week: weekParam } = await searchParams
  const anchor = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? new Date(`${weekParam}T00:00:00Z`) : new Date()
  const sheet = await getTimesheet(actor, actor.id, anchor)
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  const previous = iso(new Date(sheet.week.start.getTime() - 7 * 86_400_000))
  const next = iso(new Date(sheet.week.start.getTime() + 7 * 86_400_000))
  const today = iso(new Date())

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Timesheet"
        description="Your time, by ticket and day. Log time from the ticket itself — the timer and Log are in its sidebar."
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon" className="size-8" aria-label="Previous week">
              <Link href={`/time?week=${previous}`}>
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/time">This week</Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="size-8" aria-label="Next week">
              <Link href={`/time?week=${next}`}>
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
        }
      />
      <div className="p-4 sm:p-6">
        <p className="mb-3 text-sm text-muted-foreground">
          Week of {format(sheet.week.start, 'd MMMM yyyy')} · <span className="font-medium text-foreground">{formatMinutes(sheet.total)}</span> ({decimalHours(sheet.total)} h)
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Minutes logged per ticket per day</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-medium">Ticket</th>
                {sheet.week.days.map((day) => (
                  <th key={day.toISOString()} scope="col" className={cn('w-16 px-2 py-2 text-right font-medium', iso(day) === today && 'text-foreground')}>
                    {format(day, 'EEE d')}
                  </th>
                ))}
                <th scope="col" className="w-20 px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.ticket.id} className="border-b last:border-0">
                  <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                    <Link href={`/tickets/${row.ticket.key}`} className="flex min-w-0 items-baseline gap-2 hover:underline">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.ticket.key}</span>
                      <span className="truncate">{row.ticket.title}</span>
                    </Link>
                    <span className="block truncate text-[11px] text-muted-foreground">{row.ticket.project.name}</span>
                  </th>
                  {row.days.map((minutes, index) => (
                    <td key={index} className={cn('px-2 py-2 text-right whitespace-nowrap tabular-nums', minutes === 0 && 'text-muted-foreground/40')}>
                      {minutes ? formatMinutes(minutes) : '·'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums">{formatMinutes(row.total)}</td>
                </tr>
              ))}
              {sheet.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Nothing logged this week. Start a timer from any ticket’s sidebar.
                  </td>
                </tr>
              )}
            </tbody>
            {sheet.rows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/40 text-xs font-medium">
                  <th scope="row" className="px-3 py-2 text-left">Total</th>
                  {sheet.totals.map((minutes, index) => (
                    <td key={index} className="px-2 py-2 text-right tabular-nums">{minutes ? formatMinutes(minutes) : '·'}</td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(sheet.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
