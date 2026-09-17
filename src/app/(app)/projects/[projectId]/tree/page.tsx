import type { Metadata } from 'next'

import { getTicketTree } from '@/features/tickets/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { TicketTree } from '@/features/tickets/components/ticket-tree'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Tree' }

export default async function TreePage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  const nodes = await getTicketTree(context.actor, projectId)

  const totalChildren = nodes.reduce((sum, node) => sum + node.children.length, 0)

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Ticket hierarchy"
        description={`${nodes.length} parent ${
          nodes.length === 1 ? 'ticket' : 'tickets'
        } · ${totalChildren} child ${totalChildren === 1 ? 'ticket' : 'tickets'}`}
      />
      <TicketTree nodes={nodes} />
    </div>
  )
}
