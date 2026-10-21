import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { getProjectViewContext } from '@/features/projects/project-context'
import { getDocumentVersions } from '@/features/documents/queries'
import { DocumentView } from '@/features/documents/components/document-view'
import { HANDBOOK_KEY } from '@/core/domain/project-documents'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Document' }

export default async function DocumentPage({ params }: { params: Promise<{ projectId: string; docKey: string }> }) {
  const { projectId, docKey } = await params
  const key = decodeURIComponent(docKey)
  if (key === HANDBOOK_KEY) redirect(`/projects/${projectId}/handbook`)

  const context = await getProjectViewContext(projectId)
  const versions = await getDocumentVersions(projectId, key)
  if (versions.length === 0) notFound()

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={versions[0].title} description={`Version ${versions[0].version}`} />
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <Link
          href={`/projects/${projectId}/docs`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> All documents
        </Link>
        <DocumentView projectId={projectId} docKey={key} versions={versions} canManage={context.can.manageConfig} />
      </div>
    </div>
  )
}
