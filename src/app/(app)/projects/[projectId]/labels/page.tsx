import type { Metadata } from 'next'

import { getProjectDetail, listImportSourceProjects } from '@/features/projects/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { LabelManager } from '@/features/labels/components/label-manager'
import { PageHeader } from '@/components/shared/page-header'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { title: 'Labels' }

export default async function LabelsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)

  const [project, sources] = await Promise.all([
    getProjectDetail(projectId),
    listImportSourceProjects(context.actor, projectId),
  ])

  if (!project) notFound()

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Labels"
        description="Labels are project-specific. Attach them to tickets and filter by them in any view."
      />

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <LabelManager
          projectId={projectId}
          canEdit={context.can.manageLabels}
          labels={project.labels.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
            description: label.description,
            ticketCount: label._count.tickets,
          }))}
          sources={sources.map((source) => ({
            id: source.id,
            name: source.name,
            code: source.code,
            labelCount: source._count.labels,
          }))}
        />
      </div>
    </div>
  )
}
