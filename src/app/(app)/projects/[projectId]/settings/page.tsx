import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getProjectDetail } from '@/features/projects/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { ProjectSettingsForm } from '@/features/projects/components/project-settings-form'
import { WorkflowConfig } from '@/features/projects/components/workflow-config'
import { PageHeader } from '@/components/shared/page-header'
import { Separator } from '@/components/ui/separator'

export const metadata: Metadata = { title: 'Settings' }

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  const project = await getProjectDetail(projectId)

  if (!project) notFound()

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Settings"
        description="Project details, behaviour and workflow configuration."
      />

      <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
        <ProjectSettingsForm
          canEdit={context.can.manageConfig}
          canArchive={context.can.archiveProject}
          members={project.members.map((m) => m.user)}
          project={{
            id: project.id,
            name: project.name,
            code: project.code,
            description: project.description,
            status: project.status,
            startDate: project.startDate,
            endDate: project.endDate,
            ownerId: project.owner.id,
            isArchived: project.isArchived,
            settings: project.settings,
          }}
        />

        <Separator />

        <WorkflowConfig
          projectId={projectId}
          kind="status"
          canEdit={context.can.manageConfig}
          rows={project.statuses.map((status) => ({
            id: status.id,
            name: status.name,
            color: status.color,
            category: status.category,
            isInitial: status.isInitial,
            ticketCount: status._count.tickets,
          }))}
        />

        <WorkflowConfig
          projectId={projectId}
          kind="priority"
          canEdit={context.can.manageConfig}
          rows={project.priorities.map((priority) => ({
            id: priority.id,
            name: priority.name,
            color: priority.color,
            level: priority.level,
            isDefault: priority.isDefault,
            ticketCount: priority._count.tickets,
          }))}
        />

        <WorkflowConfig
          projectId={projectId}
          kind="type"
          canEdit={context.can.manageConfig}
          rows={project.ticketTypes.map((type) => ({
            id: type.id,
            name: type.name,
            color: type.color,
            icon: type.icon,
            isDefault: type.isDefault,
            ticketCount: type._count.tickets,
          }))}
        />
      </div>
    </div>
  )
}
