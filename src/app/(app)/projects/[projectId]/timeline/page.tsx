import type { Metadata } from 'next'

import { listTickets } from '@/features/tickets/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { TimelineView } from '@/features/tickets/components/timeline-view'
import { TicketToolbar } from '@/features/filters/components/ticket-toolbar'
import { parseFiltersFromParams } from '@/features/filters/types'
import { isAiEnabled } from '@/lib/env'

export const metadata: Metadata = { title: 'Timeline' }

export default async function TimelinePage({
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
      <TicketToolbar context={context} filters={filters} total={total} aiEnabled={isAiEnabled()} />
      <div className="min-h-0 flex-1">
        <TimelineView tickets={items} />
      </div>
    </div>
  )
}
