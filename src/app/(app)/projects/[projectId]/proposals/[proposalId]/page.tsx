import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'

import { PageHeader } from '@/components/shared/page-header'
import { RichText } from '@/components/shared/rich-text'
import { requireProjectViewPage } from '@/features/auth/guards'
import { getDocument } from '@/features/documents/queries'
import { getProposal } from '@/features/proposals/queries'
import { APPROVER_PERMISSION, type DetailsPayload, type DocumentPayload } from '@/features/proposals/service'
import { ProposalStatusBadge } from '@/features/proposals/components/proposal-status-badge'
import { DocumentDiff } from '@/features/proposals/components/document-diff'
import { DetailsDiff } from '@/features/proposals/components/details-diff'
import { ReviewPanel } from '@/features/proposals/components/review-panel'
import { HANDBOOK_KEY, detailChanges, type ProjectDetailValues } from '@/core/domain/project-documents'
import { canInProject } from '@/core/domain/rbac'

export const metadata: Metadata = { title: 'Proposal' }

const DECIDED_LABEL = { APPROVED: 'Approved', REJECTED: 'Rejected', SUPERSEDED: 'Superseded' } as const

/** "the Architecture document" → "The Architecture document". */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One change proposal: what it says, what it changes against the current state, and the decision. */
export default async function ProposalPage({ params }: { params: Promise<{ projectId: string; proposalId: string }> }) {
  const { projectId, proposalId } = await params
  const { access } = await requireProjectViewPage(projectId)
  const proposal = await getProposal(projectId, proposalId)
  if (!proposal) notFound()

  const pending = proposal.status === 'PENDING'
  const canReview = pending && canInProject(access, APPROVER_PERMISSION[proposal.kind])
  const assessment = proposal.assessment
  const proposer = proposal.proposedBy ?? 'a former member'
  const documentKey = proposal.documentKey ?? ''

  let body: ReactNode
  let staleMessage: string | undefined

  if (proposal.kind === 'DOCUMENT') {
    const payload = proposal.payload as DocumentPayload

    let currentTitle = ''
    let currentBody = ''
    let comparedWith: number
    if (assessment?.kind === 'DOCUMENT') {
      currentTitle = assessment.current?.title ?? ''
      currentBody = assessment.current?.body ?? ''
      comparedWith = assessment.latestVersion
    } else {
      const base = proposal.baseVersion ?? 0
      const before = base > 0 ? await getDocument(projectId, documentKey, base) : null
      currentTitle = before?.title ?? ''
      currentBody = before?.body ?? ''
      comparedWith = base
    }

    if (assessment?.kind === 'DOCUMENT' && assessment.stale) {
      staleMessage = `This was written against version ${proposal.baseVersion}; the document is now at version ${assessment.latestVersion}. Approving replaces that version's text with this one.`
    }

    body = (
      <>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">What changes</h2>
          <p className="text-xs text-muted-foreground">
            {comparedWith === 0 ? 'A new document' : `Compared with version ${comparedWith}`}
          </p>
          {currentTitle && currentTitle !== payload.title && (
            <p className="text-sm">
              Title: {currentTitle} → {payload.title}
            </p>
          )}
          <DocumentDiff before={currentBody} after={payload.body} />
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Read the proposed document</summary>
            <div className="border-t p-4 sm:p-6">
              <RichText content={payload.body} className="text-[15px]" />
            </div>
          </details>
        </section>
      </>
    )
  } else {
    const payload = proposal.payload as DetailsPayload
    // Pending: against the project as it is now. Decided: against the values it
    // was written against, which is what the reviewer saw.
    const current: ProjectDetailValues =
      assessment?.kind === 'PROJECT_DETAILS'
        ? assessment.current
        : { description: null, status: '', startDate: null, endDate: null, ...((proposal.baseValues ?? {}) as DetailsPayload) }
    const changes = detailChanges(current, payload)

    if (assessment?.kind === 'PROJECT_DETAILS' && assessment.stale) {
      staleMessage = 'Some of these fields have changed since it was proposed. Approving sets them to the proposed values.'
    }

    body = (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">What changes</h2>
        <DetailsDiff changes={changes} staleFields={assessment?.kind === 'PROJECT_DETAILS' ? assessment.staleFields : []} />
      </section>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title={capitalise(proposal.target)}
        description={`Proposed by ${proposer} ${formatDistanceToNow(proposal.createdAt, { addSuffix: true })}`}
        actions={<ProposalStatusBadge status={proposal.status} />}
      />
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <Link href={`/projects/${projectId}/proposals`} className="inline-block text-sm text-muted-foreground hover:text-foreground">
          ← All proposals
        </Link>

        {(proposal.summary || proposal.rationale) && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Why</h2>
            {proposal.summary && <p className="font-medium">{proposal.summary}</p>}
            {proposal.rationale && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.rationale}</p>}
          </section>
        )}

        {proposal.status !== 'PENDING' && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Decision</h2>
            <p className="text-sm">
              {DECIDED_LABEL[proposal.status]}
              {proposal.reviewedBy ? ` by ${proposal.reviewedBy}` : ''}
              {proposal.reviewedAt ? ` on ${format(proposal.reviewedAt, 'd MMM yyyy, HH:mm')}` : ''}
            </p>
            {proposal.reviewNote && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.reviewNote}</p>}
            {proposal.status === 'APPROVED' && proposal.kind === 'DOCUMENT' && proposal.appliedVersion && (
              <Link
                href={
                  proposal.documentKey === HANDBOOK_KEY
                    ? `/projects/${projectId}/handbook`
                    : `/projects/${projectId}/docs/${documentKey}`
                }
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Open version {proposal.appliedVersion}
              </Link>
            )}
          </section>
        )}

        {body}

        {canReview && (
          <ReviewPanel proposalId={proposal.id} stale={assessment?.stale ?? false} staleMessage={staleMessage} />
        )}
        {pending && !canReview && (
          <p className="text-sm text-muted-foreground">Waiting for a project manager to approve or reject it.</p>
        )}
      </div>
    </div>
  )
}
