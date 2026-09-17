import type { Metadata } from 'next'

import { requireUser } from '@/features/auth/guards'
import { listTickets } from '@/features/tickets/queries'
import { getWorkspaceViewContext } from '@/features/projects/project-context'
import { TicketTable } from '@/features/tickets/components/ticket-table'
import { TicketToolbar } from '@/features/filters/components/ticket-toolbar'
import { SavedFilterBar } from '@/features/filters/components/saved-filter-bar'
import { listSavedFilters } from '@/features/filters/actions'
import { parseFiltersFromParams } from '@/features/filters/types'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'My Tickets' }

export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requireUser()
  const rawParams = await searchParams

  const context = await getWorkspaceViewContext()
  const savedFilters = await listSavedFilters()

  const parsed = parseFiltersFromParams(rawParams)

  // "My Tickets" is scoped to the current user unless they explicitly widen it
  // by choosing assignees in the filter bar.
  const filters =
    parsed.assigneeIds.length > 0 ? parsed : { ...parsed, assigneeIds: [actor.id] }

  const { items, total } = await listTickets(actor, filters)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="My Tickets"
        description="Everything assigned to you, across every project."
      />

      <SavedFilterBar filters={savedFilters} />
      <TicketToolbar context={context} filters={filters} total={total} />

      <div className="min-h-0 flex-1">
        <TicketTable tickets={items} context={context} showProjectColumn />
      </div>
    </div>
  )
}
