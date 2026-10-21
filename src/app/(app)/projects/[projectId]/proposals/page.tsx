import type { Metadata } from 'next'
import Link from 'next/link'
import type { ProposalStatus } from '@prisma/client'
import { FileDiff, FileText, Settings2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { PageHeader, EmptyState } from '@/components/shared/page-header'
import { requireProjectViewPage } from '@/features/auth/guards'
import { listProposals } from '@/features/proposals/queries'
import { ProposalStatusBadge } from '@/features/proposals/components/proposal-status-badge'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Proposals' }

const FILTERS: { key: string; label: string; status?: ProposalStatus }[] = [
  { key: 'pending', label: 'Pending', status: 'PENDING' },
  { key: 'approved', label: 'Approved', status: 'APPROVED' },
  { key: 'rejected', label: 'Rejected', status: 'REJECTED' },
  { key: 'superseded', label: 'Superseded', status: 'SUPERSEDED' },
  { key: 'all', label: 'All' },
]

/** "the Architecture document" → "The Architecture document". */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The change proposals for a project, filterable by status, newest first. */
export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { projectId } = await params
  const { status } = await searchParams
  await requireProjectViewPage(projectId)

  const filter = FILTERS.find((entry) => entry.key === status) ?? FILTERS[0]
  const rows = await listProposals(projectId, { status: filter.status })

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Proposals"
        description="Changes to this project's details and documents, proposed by people and agents. Nothing applies until a project manager approves it."
      />
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((entry) => {
            const active = entry.key === filter.key
            return (
              <Link
                key={entry.key}
                href={`/projects/${projectId}/proposals?status=${entry.key}`}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {entry.label}
              </Link>
            )
          })}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={FileDiff}
            title={filter.key === 'pending' ? 'Nothing waiting' : 'No proposals'}
            description="Agents propose with the propose_document and propose_project_update tools; their proposals appear here."
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {rows.map((row) => {
              const Icon = row.kind === 'DOCUMENT' ? FileText : Settings2
              const meta = [
                `${row.proposedBy ?? 'A former member'} · ${formatDistanceToNow(row.createdAt, { addSuffix: true })}`,
                row.kind === 'DOCUMENT' && row.baseVersion === 0 ? 'new document' : null,
                row.appliedVersion ? `became version ${row.appliedVersion}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={row.id}>
                  <Link
                    href={`/projects/${projectId}/proposals/${row.id}`}
                    className="flex min-w-0 items-start gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{capitalise(row.target)}</span>
                        <span className="shrink-0">
                          <ProposalStatusBadge status={row.status} />
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{meta}</p>
                      {row.summary && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{row.summary}</p>}
                    </div>
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
