import type { Metadata } from 'next'

import { getProjectViewContext } from '@/features/projects/project-context'
import { prisma } from '@/infrastructure/db/prisma'
import { HandbookView } from '@/features/memory/components/handbook-view'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Handbook' }

export default async function HandbookPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  const versions = await prisma.projectDocument.findMany({
    where: { projectId, kind: 'HANDBOOK' },
    orderBy: { version: 'desc' },
    take: 30,
    select: { version: true, title: true, body: true, source: true, engine: true, createdAt: true, author: { select: { name: true } } },
  })
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Handbook" description="Everything someone joining this project needs on day one — written from what the project already records." />
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <HandbookView
          projectId={projectId}
          canManage={context.can.manageConfig}
          versions={versions.map(({ author, ...entry }) => ({ ...entry, author: author?.name ?? null }))}
        />
      </div>
    </div>
  )
}
