import type { Prisma, ProposalKind } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { appUrl } from '@/features/notifications/email'
import type { Permission } from '@/core/domain/rbac'
import {
  HANDBOOK_KEY,
  detailValues,
  isDocumentStale,
  staleDetailFields,
  titleFromKey,
  type ProjectDetailField,
  type ProjectDetailValues,
} from '@/core/domain/project-documents'

type Tx = Prisma.TransactionClient

/**
 * Change proposals: how an agent changes a project's details or documents.
 *
 * An agent — over MCP, the REST API or the Copilot — never writes those
 * directly. It proposes; the proposal waits; a person who may make the change
 * by hand approves or rejects it on the project's Proposals page. Approval
 * applies the change through the same writer as the person's own edit, in the
 * same transaction as the approval, and every proposal needs that click — even
 * one made through a manager's own token, since the point is that a person has
 * read what the agent wrote.
 */

/** What a proposal of each kind needs to be approved: what the edit by hand needs. */
export const APPROVER_PERMISSION: Record<ProposalKind, Permission> = {
  PROJECT_DETAILS: 'project:update',
  DOCUMENT: 'project:manage-config',
}

/** PROJECT_DETAILS payload: only the proposed fields, normalised; null clears. */
export type DetailsPayload = Partial<ProjectDetailValues>

/** DOCUMENT payload. */
export interface DocumentPayload {
  title: string
  body: string
}

export function proposalPath(projectId: string, proposalId: string): string {
  return `/projects/${projectId}/proposals/${proposalId}`
}

/**
 * The review page as a full URL where the deployment's address is known, so a
 * tool result can hand an agent's user something to click. Vercel exposes the
 * production host even where NEXT_PUBLIC_APP_URL was never set.
 */
export function proposalUrl(projectId: string, proposalId: string): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const base = appUrl() || (vercel ? `https://${vercel}` : '')
  return `${base}${proposalPath(projectId, proposalId)}`
}

/** "the Architecture document", "the handbook", "the project details". */
export function targetLabel(kind: ProposalKind, documentKey: string | null, title?: string | null): string {
  if (kind === 'PROJECT_DETAILS') return 'the project details'
  if (documentKey === HANDBOOK_KEY) return 'the handbook'
  return `the ${title || titleFromKey(documentKey ?? 'document')} document`
}

/**
 * Who may approve a proposal of this kind in this project, to be told about it:
 * the owner and the project's managers — directly or through an attached team —
 * whose role holds the permission. Agents and deactivated accounts are left out.
 */
export async function projectApprovers(tx: Tx, projectId: string, permission: Permission): Promise<string[]> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      members: { where: { role: 'MANAGER' }, select: { userId: true } },
      teams: { where: { role: 'MANAGER' }, select: { team: { select: { members: { select: { userId: true } } } } } },
    },
  })
  if (!project) return []
  const candidates = new Set([
    project.ownerId,
    ...project.members.map((member) => member.userId),
    ...project.teams.flatMap((link) => link.team.members.map((member) => member.userId)),
  ])
  const users = await tx.user.findMany({
    where: {
      id: { in: [...candidates] },
      isActive: true,
      isAgent: false,
      role: { permissions: { some: { permission } } },
    },
    select: { id: true },
  })
  return users.map((user) => user.id)
}

export type ProposalAssessment =
  | {
      kind: 'DOCUMENT'
      /** The document's latest version now; 0 when it does not exist yet. */
      latestVersion: number
      current: { title: string; body: string } | null
      stale: boolean
    }
  | {
      kind: 'PROJECT_DETAILS'
      current: ProjectDetailValues
      staleFields: ProjectDetailField[]
      stale: boolean
    }

/**
 * Where the proposal's target stands now, and whether it has moved since the
 * proposal was written. A stale proposal can still be approved, but only by
 * someone who has seen the difference and says so.
 */
export async function assessProposal(
  proposal: { projectId: string; kind: ProposalKind; documentKey: string | null; baseVersion: number | null; baseValues: Prisma.JsonValue | null },
  tx: Tx = prisma,
): Promise<ProposalAssessment> {
  if (proposal.kind === 'DOCUMENT') {
    const latest = await tx.projectDocument.findFirst({
      where: { projectId: proposal.projectId, kind: proposal.documentKey ?? '' },
      orderBy: { version: 'desc' },
      select: { version: true, title: true, body: true },
    })
    const latestVersion = latest?.version ?? 0
    return {
      kind: 'DOCUMENT',
      latestVersion,
      current: latest ? { title: latest.title, body: latest.body } : null,
      stale: isDocumentStale(proposal.baseVersion, latestVersion),
    }
  }

  const project = await tx.project.findUniqueOrThrow({
    where: { id: proposal.projectId },
    select: { description: true, status: true, startDate: true, endDate: true },
  })
  const current = detailValues(project)
  const staleFields = staleDetailFields((proposal.baseValues ?? {}) as DetailsPayload, current)
  return { kind: 'PROJECT_DETAILS', current, staleFields, stale: staleFields.length > 0 }
}
