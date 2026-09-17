import type { Metadata } from 'next'

import { prisma } from '@/infrastructure/db/prisma'
import { getProjectViewContext } from '@/features/projects/project-context'
import { RecurringManager } from '@/features/recurring/components/recurring-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Recurring' }

export default async function RecurringPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)

  const schedules = await prisma.recurringTicket.findMany({
    where: { projectId },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      frequency: true,
      interval: true,
      dayOfWeek: true,
      dayOfMonth: true,
      dueInDays: true,
      startDate: true,
      endDate: true,
      nextRunAt: true,
      lastRunAt: true,
      runCount: true,
      isActive: true,
      statusId: true,
      priorityId: true,
      typeId: true,
      assigneeId: true,
      assignee: { select: { name: true } },
      labels: { select: { labelId: true } },
      _count: { select: { generatedTickets: true } },
    },
    orderBy: [{ isActive: 'desc' }, { nextRunAt: 'asc' }],
  })

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Recurring tickets"
        description="Work that happens on a rhythm. A ticket is generated automatically on each occurrence."
      />

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <RecurringManager
          canManage={context.can.manageRecurring}
          config={{
            projectId,
            statuses: context.statuses,
            priorities: context.priorities,
            types: context.types,
            labels: context.labels,
            members: context.members,
          }}
          schedules={schedules.map((schedule) => ({
            ...schedule,
            assigneeName: schedule.assignee?.name ?? null,
            labelIds: schedule.labels.map((label) => label.labelId),
            generatedCount: schedule._count.generatedTickets,
          }))}
        />
      </div>
    </div>
  )
}
