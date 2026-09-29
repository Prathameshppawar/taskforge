import type { Metadata } from 'next'

import { getProjectViewContext } from '@/features/projects/project-context'
import { getPlanning } from '@/features/cycles/queries'
import { PlanningBoard } from '@/features/cycles/components/planning-board'
import { agentEngine } from '@/features/ai-admin/engines'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Plan' }

export default async function PlanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  const [planning, planner] = await Promise.all([getPlanning(context.actor, projectId), agentEngine('planner')])

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Plan"
        description="Sprints and milestones above the ranked backlog. Drag to plan and to rank; the top of the backlog is what comes next."
      />
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <PlanningBoard
          projectId={projectId}
          planning={planning}
          canPlan={context.can.updateTicket}
          canManage={context.can.manageConfig}
          plannerAvailable={planner !== null}
        />
      </div>
    </div>
  )
}
