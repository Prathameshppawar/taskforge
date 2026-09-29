import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getProjectViewContext } from '@/features/projects/project-context'
import { ImportWizard } from '@/features/import/components/import-wizard'
import { prisma } from '@/infrastructure/db/prisma'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Import' }

export default async function ImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  if (!context.can.manageConfig) redirect(`/projects/${projectId}/board`)

  const [statuses, members] = await Promise.all([
    prisma.status.findMany({ where: { projectId }, orderBy: { position: 'asc' }, select: { id: true, name: true, category: true } }),
    prisma.projectMember.findMany({
      where: { projectId, user: { isActive: true, isAgent: false } },
      select: { user: { select: { id: true, name: true, email: true, username: true } } },
    }),
  ])

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Import"
        description="Bring tickets in from Jira, Trello or a spreadsheet — statuses, people, labels, checklists, comments and parents included."
      />
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <ImportWizard
          projectId={projectId}
          statuses={statuses}
          types={context.types}
          priorities={context.priorities}
          members={members.map((member) => member.user)}
        />
      </div>
    </div>
  )
}
