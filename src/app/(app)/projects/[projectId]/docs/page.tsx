import type { Metadata } from 'next'
import Link from 'next/link'
import { format } from 'date-fns'
import { BookOpen, FileText } from 'lucide-react'

import { getProjectViewContext } from '@/features/projects/project-context'
import { listProjectDocuments } from '@/features/documents/queries'
import { NewDocumentDialog } from '@/features/documents/components/new-document-dialog'
import { DOCUMENT_SOURCE_LABELS as SOURCE_LABEL, HANDBOOK_KEY } from '@/core/domain/project-documents'
import { PageHeader, EmptyState } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Docs' }

/** Every document the project keeps, the handbook first. */
export default async function DocsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)
  const documents = await listProjectDocuments(projectId)
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Docs"
        description="The project's documents — the handbook and the named documents beside it. Every version is kept, and agents propose changes for a manager to approve."
        actions={context.can.manageConfig ? <NewDocumentDialog projectId={projectId} existingKeys={documents.map((document) => document.key)} /> : undefined}
      />
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Start one here, or let an agent propose one over MCP — it waits under Proposals until a manager approves it."
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {documents.map((document) => {
              const isHandbook = document.key === HANDBOOK_KEY
              const Icon = isHandbook ? BookOpen : FileText
              return (
                <li key={document.key}>
                  <Link
                    href={isHandbook ? `/projects/${projectId}/handbook` : `/projects/${projectId}/docs/${document.key}`}
                    className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{document.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Version {document.latestVersion} · {format(document.updatedAt, 'd MMM yyyy')}
                        {document.author ? ` · ${document.author}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className="max-w-[45%] shrink-0 truncate">
                      {SOURCE_LABEL[document.source] ?? document.source}
                    </Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
