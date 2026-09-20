import type { Metadata } from 'next'

import { getBoardData } from '@/features/tickets/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { BoardView } from '@/features/tickets/components/board-view'
import { TicketToolbar } from '@/features/filters/components/ticket-toolbar'
import { parseFiltersFromParams } from '@/features/filters/types'
import { isAiEnabled } from '@/lib/env'

export const metadata: Metadata = { title: 'Board' }

export default async function BoardPage({
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
  const { columns } = await getBoardData(context.actor, projectId, filters)

  return (
    <div className="flex h-full flex-col">
      <TicketToolbar
        aiEnabled={isAiEnabled()}
        context={context}
        filters={filters}
        total={columns.reduce((sum, column) => sum + column.tickets.length, 0)}
      />

      <div className="min-h-0 flex-1">
        <BoardView
          columns={columns}
          config={context.formConfig}
          canEdit={context.can.transition}
        />
      </div>
    </div>
  )
}
