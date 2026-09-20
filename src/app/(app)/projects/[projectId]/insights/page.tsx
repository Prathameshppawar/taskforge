import type { Metadata } from 'next'

import { getProjectViewContext } from '@/features/projects/project-context'
import {
  getCompletionRate,
  getLabelDistribution,
  getPriorityDistribution,
  getStatCounts,
  getStatusDistribution,
  getTeamWorkload,
  getTicketTrend,
} from '@/features/dashboard/queries'
import { StatTiles, CompletionCard } from '@/features/dashboard/components/stat-tiles'
import {
  LabelChart,
  PriorityChart,
  StatusChart,
  TicketTrendChart,
  WorkloadChart,
} from '@/features/dashboard/components/charts'
import { WorkloadTable } from '@/features/dashboard/components/workload-table'
import { PageHeader } from '@/components/shared/page-header'
import { isAiEnabled } from '@/lib/env'
import { StatusReportCard } from '@/features/reports/components/status-report'

export const metadata: Metadata = { title: 'Insights' }

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  const scope = { projectId }

  const [stats, completion, trend, priorities, labels, statuses, workload] = await Promise.all([
    getStatCounts(context.actor, scope),
    getCompletionRate(context.actor, scope),
    getTicketTrend(context.actor, scope, 30),
    getPriorityDistribution(context.actor, scope),
    getLabelDistribution(context.actor, scope),
    getStatusDistribution(context.actor, scope),
    getTeamWorkload(context.actor, scope),
  ])

  const aiEnabled = isAiEnabled()

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Insights" description="Project health at a glance." />

      <div className="space-y-4 p-4 sm:p-6">
        <StatTiles stats={stats} basePath={`/projects/${projectId}/table`} />

        {aiEnabled && <StatusReportCard projectId={projectId} />}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <CompletionCard
            percent={completion.percent}
            completed={completion.completed}
            countable={completion.countable}
          />
          <TicketTrendChart data={trend} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PriorityChart data={priorities} />
          <StatusChart data={statuses} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <LabelChart data={labels} />
          <WorkloadChart data={workload} />
        </div>

        <WorkloadTable rows={workload} />
      </div>
    </div>
  )
}
