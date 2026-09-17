import type { Metadata } from 'next'

import { listTickets } from '@/features/tickets/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { CalendarView } from '@/features/tickets/components/calendar-view'
import { TicketToolbar } from '@/features/filters/components/ticket-toolbar'
import { parseFiltersFromParams } from '@/features/filters/types'

export const metadata: Metadata = { title: 'Calendar' }

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { projectId } = await params
  const rawParams = await searchParams

  const context = await getProjectViewContext(projectId)
  const filters = parseFiltersFromParams(rawParams)
  const { items, total } = await listTickets(context.actor, filters, { projectId })

  return (
    <div className="flex h-full flex-col">
      <TicketToolbar context={context} filters={filters} total={total} />
      <div className="min-h-0 flex-1">
        <CalendarView tickets={items} />
      </div>
    </div>
  )
}
