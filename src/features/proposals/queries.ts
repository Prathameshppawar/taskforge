import type { Prisma, ProposalKind, ProposalStatus } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { assessProposal, targetLabel, type DetailsPayload, type DocumentPayload, type ProposalAssessment } from './service'

/**
 * Reads of a project's change proposals. Callers check project visibility
 * first; anyone who can see the project can see what has been proposed for it.
 */

/** The number on the Proposals tab. Served by the (project, status, created) index. */
export async function pendingProposalCount(projectId: string): Promise<number> {
  return prisma.projectChangeProposal.count({ where: { projectId, status: 'PENDING' } })
}

export interface ProposalRow {
  id: string
  kind: ProposalKind
  status: ProposalStatus
  documentKey: string | null
  target: string
  summary: string | null
  proposedBy: string | null
  reviewedBy: string | null
  createdAt: Date
  reviewedAt: Date | null
  baseVersion: number | null
  /** What a details proposal was written against; see `assessProposal`. */
  baseValues: Prisma.JsonValue | null
  appliedVersion: number | null
}

export async function listProposals(
  projectId: string,
  options: { status?: ProposalStatus; take?: number } = {},
): Promise<ProposalRow[]> {
  const rows = await prisma.projectChangeProposal.findMany({
    where: { projectId, ...(options.status ? { status: options.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 100,
    select: {
      id: true,
      kind: true,
      status: true,
      documentKey: true,
      // The payload is read for the title only; Postgres still sends the body,
      // which is why the list is capped.
      payload: true,
      summary: true,
      createdAt: true,
      reviewedAt: true,
      baseVersion: true,
      baseValues: true,
      appliedVersion: true,
      proposedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  })
  return rows.map(({ payload, proposedBy, reviewedBy, ...row }) => ({
    ...row,
    target: targetLabel(row.kind, row.documentKey, (payload as Partial<DocumentPayload>).title),
    proposedBy: proposedBy?.name ?? null,
    reviewedBy: reviewedBy?.name ?? null,
  }))
}

export interface ProposalDetail extends ProposalRow {
  projectId: string
  rationale: string | null
  reviewNote: string | null
  payload: DocumentPayload | DetailsPayload
  /** Where the target stands now; only worked out while the proposal is pending. */
  assessment: ProposalAssessment | null
}

export async function getProposal(projectId: string, proposalId: string): Promise<ProposalDetail | null> {
  const row = await prisma.projectChangeProposal.findFirst({
    where: { id: proposalId, projectId },
    select: {
      id: true,
      projectId: true,
      kind: true,
      status: true,
      documentKey: true,
      payload: true,
      summary: true,
      rationale: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
      baseVersion: true,
      baseValues: true,
      appliedVersion: true,
      proposedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  })
  if (!row) return null
  const { proposedBy, reviewedBy, ...rest } = row
  const payload = row.payload as unknown as DocumentPayload | DetailsPayload
  return {
    ...rest,
    payload,
    target: targetLabel(row.kind, row.documentKey, (payload as Partial<DocumentPayload>).title),
    proposedBy: proposedBy?.name ?? null,
    reviewedBy: reviewedBy?.name ?? null,
    assessment: row.status === 'PENDING' ? await assessProposal(row) : null,
  }
}
