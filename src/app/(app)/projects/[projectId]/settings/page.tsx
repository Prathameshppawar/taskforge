import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getProjectDetail } from '@/features/projects/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { ProjectSettingsForm } from '@/features/projects/components/project-settings-form'
import { WorkflowConfig } from '@/features/projects/components/workflow-config'
import { FlowSettings } from '@/features/projects/components/flow-settings'
import { BillingSettings } from '@/features/projects/components/billing-settings'
import { getProjectRepos } from '@/features/github/queries'
import { ProjectRepositories } from '@/features/github/components/project-repos'
import { can } from '@/features/auth/guards'
import { ErrorIntake } from '@/features/errors/components/error-intake'
import { getProjectMonitors } from '@/features/monitors/queries'
import { Monitors } from '@/features/monitors/components/monitors'
import { prisma } from '@/infrastructure/db/prisma'
import { headers } from 'next/headers'
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
  const [project, repos] = await Promise.all([
    getProjectDetail(projectId),
    getProjectRepos(projectId),
  ])

  if (!project) notFound()
  const [intake, monitors] = await Promise.all([
    prisma.projectSettings.findUnique({ where: { projectId }, select: { errorIngestHash: true } }),
    getProjectMonitors(projectId),
  ])
  const headerList = await headers()
  const origin = `${headerList.get('x-forwarded-proto') ?? 'http'}://${headerList.get('host')}`

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

        <ProjectRepositories
          projectId={projectId}
          projectCode={project.code}
          repos={repos}
          canEdit={context.can.manageConfig}
          canManageIntegrations={can(context.actor, 'integration:manage')}
        />

        <Separator />

        <Monitors projectId={projectId} monitors={monitors} canEdit={context.can.manageConfig} />

        <Separator />

        <ErrorIntake
          projectId={projectId}
          configured={Boolean(intake?.errorIngestHash)}
          canEdit={context.can.manageConfig}
          origin={origin}
        />

        <Separator />

        <FlowSettings
          projectId={projectId}
          stuckAfterDays={project.settings?.stuckAfterDays ?? null}
          slaKinds={project.settings?.slaKinds ?? ''}
          canEdit={context.can.manageConfig}
        />

        <Separator />

        <BillingSettings
          projectId={projectId}
          hourlyRate={project.settings?.hourlyRate ?? null}
          currency={project.settings?.currency ?? 'USD'}
          canEdit={context.can.manageConfig}
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
            wipLimit: status.wipLimit,
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
            respondWithinHours: priority.respondWithinHours,
            resolveWithinHours: priority.resolveWithinHours,
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
            ticketKind: type.kind,
            descriptionTemplate: type.descriptionTemplate,
            checklistTemplate: type.checklistTemplate,
            ticketCount: type._count.tickets,
          }))}
        />
      </div>
    </div>
  )
}
