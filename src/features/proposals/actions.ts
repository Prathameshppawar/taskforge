'use server'

import { revalidatePath } from 'next/cache'
import type { Prisma, ProposalKind } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission } from '@/features/auth/guards'
import { notify, preview } from '@/features/notifications/service'
import { writeDocumentVersion } from '@/features/documents/service'
import { writeProjectDetails } from '@/features/projects/service'
import { updateProjectSchema } from '@/features/projects/schemas'
import { enqueue } from '@/features/jobs/queue'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { ConflictError, NotFoundError } from '@/core/domain/errors'
import { detailChanges, detailValues, documentKey, titleFromKey } from '@/core/domain/project-documents'
import { runAction } from '@/lib/safe-action'
import {
  describeIssues,
  proposeDocumentSchema,
  proposeProjectDetailsSchema,
  reviewProposalSchema,
  type ProposeDocumentInput,
  type ProposeProjectDetailsInput,
  type ReviewProposalInput,
} from './schemas'
import {
  APPROVER_PERMISSION,
  assessProposal,
  projectApprovers,
  proposalPath,
  targetLabel,
  type DetailsPayload,
  type DocumentPayload,
} from './service'

/**
 * Proposing, approving and rejecting changes to a project's details and
 * documents. See `service.ts` for why agents propose rather than write.
 */

export interface ProposalCreated {
  id: string
  projectId: string
  /** What it changes, for the agent's reply: "the Architecture document". */
  target: string
  /** Earlier pending proposals from the same person for the same target, now superseded. */
  superseded: string[]
}

// -----------------------------------------------------------------------------
// Proposing
// -----------------------------------------------------------------------------

export async function proposeProjectDetailsAction(
  input: ProposeProjectDetailsInput,
): Promise<ActionResult<ProposalCreated>> {
  return runAction(async () => {
    const parsed = proposeProjectDetailsSchema.safeParse(input)
    if (!parsed.success) return fail(describeIssues(parsed.error), { code: 'VALIDATION_ERROR' })
    const data = parsed.data
    const { actor } = await requireProjectPermission(data.projectId, 'proposal:create')

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: data.projectId },
      select: { id: true, name: true, description: true, status: true, startDate: true, endDate: true, ownerId: true, isArchived: true },
    })
    if (project.isArchived) return fail(`${project.name} is archived, so changes cannot be proposed.`)

    const clear = (value: string | undefined) => (value === undefined ? undefined : value === '' || value.toLowerCase() === 'none' ? null : value)
    const payload: DetailsPayload = Object.fromEntries(
      Object.entries({
        description: clear(data.description),
        status: data.status,
        startDate: clear(data.startDate),
        endDate: clear(data.endDate),
      }).filter(([, value]) => value !== undefined),
    )

    const current = detailValues(project)
    if (detailChanges(current, payload).length === 0) {
      return fail('That is already how the project stands, so there is nothing to propose.')
    }

    // Checked now with the same schema the approval will use, so a proposal
    // that could never be applied — an end before the start — is refused here.
    const merged = { ...current, ...payload }
    const check = updateProjectSchema.safeParse({
      id: project.id,
      name: project.name,
      ownerId: project.ownerId,
      description: merged.description ?? '',
      status: merged.status,
      startDate: merged.startDate,
      endDate: merged.endDate,
    })
    if (!check.success) return fail(check.error.issues[0]?.message ?? 'Those details are not valid.')

    // The values the proposal was written against, field by field.
    const baseValues = Object.fromEntries(Object.keys(payload).map((field) => [field, current[field as keyof typeof current]]))

    const created = await createProposal({
      projectId: project.id,
      kind: 'PROJECT_DETAILS',
      documentKey: null,
      payload,
      baseVersion: null,
      baseValues,
      summary: data.summary,
      rationale: data.rationale,
      actor,
      target: 'the project details',
    })
    return ok(created)
  })
}

export async function proposeDocumentAction(input: ProposeDocumentInput): Promise<ActionResult<ProposalCreated>> {
  return runAction(async () => {
    const parsed = proposeDocumentSchema.safeParse(input)
    if (!parsed.success) return fail(describeIssues(parsed.error), { code: 'VALIDATION_ERROR' })
    const data = parsed.data
    const { actor } = await requireProjectPermission(data.projectId, 'proposal:create')

    const project = await prisma.project.findUniqueOrThrow({ where: { id: data.projectId }, select: { name: true, isArchived: true } })
    if (project.isArchived) return fail(`${project.name} is archived, so changes cannot be proposed.`)

    const key = documentKey(data.name)
    if (!key) return fail('Name the document with letters or numbers, e.g. "Architecture".')

    const latest = await prisma.projectDocument.findFirst({
      where: { projectId: data.projectId, kind: key },
      orderBy: { version: 'desc' },
      select: { version: true, title: true, body: true },
    })
    const latestVersion = latest?.version ?? 0
    const baseVersion = data.baseVersion ?? latestVersion
    if (baseVersion > latestVersion) {
      return fail(latestVersion === 0 ? `There is no document "${data.name}" yet; propose it without a base version.` : `The latest version of that document is ${latestVersion}, not ${baseVersion}.`)
    }

    const title = data.title ?? latest?.title ?? titleFromKey(key)
    if (latest && latest.body.trim() === data.body.trim() && latest.title === title) {
      return fail(`That is identical to version ${latest.version}, so there is nothing to propose.`)
    }

    const created = await createProposal({
      projectId: data.projectId,
      kind: 'DOCUMENT',
      documentKey: key,
      payload: { title, body: data.body } satisfies DocumentPayload,
      baseVersion,
      baseValues: null,
      summary: data.summary,
      rationale: data.rationale,
      actor,
      target: targetLabel('DOCUMENT', key, title),
    })
    return ok(created)
  })
}

/**
 * Writes a proposal, supersedes the proposer's own earlier pending one for the
 * same target (an agent revising its draft should not leave two to review),
 * records it, and tells the people who can approve it.
 */
async function createProposal(input: {
  projectId: string
  kind: ProposalKind
  documentKey: string | null
  payload: Prisma.InputJsonValue
  baseVersion: number | null
  baseValues: Prisma.InputJsonValue | null
  summary?: string
  rationale?: string
  actor: { id: string; name: string }
  target: string
}): Promise<ProposalCreated> {
  const result = await prisma.$transaction(async (tx) => {
    const earlier = await tx.projectChangeProposal.findMany({
      where: { projectId: input.projectId, kind: input.kind, documentKey: input.documentKey, proposedById: input.actor.id, status: 'PENDING' },
      select: { id: true },
    })
    if (earlier.length) {
      await tx.projectChangeProposal.updateMany({ where: { id: { in: earlier.map((row) => row.id) } }, data: { status: 'SUPERSEDED' } })
    }

    const proposal = await tx.projectChangeProposal.create({
      data: {
        projectId: input.projectId,
        kind: input.kind,
        documentKey: input.documentKey,
        payload: input.payload,
        baseVersion: input.baseVersion,
        ...(input.baseValues ? { baseValues: input.baseValues } : {}),
        summary: input.summary || null,
        rationale: input.rationale || null,
        proposedById: input.actor.id,
      },
      select: { id: true },
    })

    await recordActivity(tx, {
      action: 'CREATED',
      entityType: 'PROJECT',
      entityId: input.projectId,
      projectId: input.projectId,
      actorId: input.actor.id,
      field: 'proposal',
      newValue: proposal.id,
      summary: `proposed a change to ${input.target}, waiting for approval`,
    })

    // The proposer is told as well when they could approve it themselves: a
    // proposal made through their token is an agent's work, and still needs
    // them to read it and click Approve.
    await notify(tx, {
      userIds: await projectApprovers(tx, input.projectId, APPROVER_PERMISSION[input.kind]),
      includeActor: true,
      type: 'PROPOSAL_PENDING',
      actorId: input.actor.id,
      title: `${input.actor.name} proposed a change to ${input.target}`,
      body: input.summary ? preview(input.summary) : 'Review it before it applies.',
      link: proposalPath(input.projectId, proposal.id),
    })

    return { id: proposal.id, superseded: earlier.map((row) => row.id) }
  })

  revalidatePath(`/projects/${input.projectId}`, 'layout')
  return { ...result, projectId: input.projectId, target: input.target }
}

// -----------------------------------------------------------------------------
// Reviewing
// -----------------------------------------------------------------------------

/** Loads a pending proposal and checks the reviewer may decide it. */
async function loadForReview(proposalId: string) {
  const proposal = await prisma.projectChangeProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      projectId: true,
      kind: true,
      documentKey: true,
      payload: true,
      status: true,
      baseVersion: true,
      baseValues: true,
      proposedById: true,
      proposedBy: { select: { name: true } },
    },
  })
  if (!proposal) throw new NotFoundError('Proposal', proposalId)
  const { actor } = await requireProjectPermission(proposal.projectId, APPROVER_PERMISSION[proposal.kind])
  return { proposal, actor }
}

const ALREADY: Record<string, string> = {
  APPROVED: 'This proposal has already been approved.',
  REJECTED: 'This proposal has already been rejected.',
  SUPERSEDED: 'This proposal was replaced by a later one from the same person.',
}

/**
 * Approves a proposal and applies it, in one transaction: the proposal is
 * claimed (so two reviewers cannot both apply it), the change goes through the
 * same writer as a person's edit, and the activity entry names the approver as
 * the actor and the proposer in its summary.
 */
export async function approveProposalAction(input: ReviewProposalInput): Promise<ActionResult<{ version?: number }>> {
  return runAction(async () => {
    const data = reviewProposalSchema.parse(input)
    const { proposal, actor } = await loadForReview(data.proposalId)
    if (proposal.status !== 'PENDING') return fail(ALREADY[proposal.status] ?? 'This proposal is no longer pending.', { code: 'CONFLICT' })

    const assessment = await assessProposal(proposal)
    if (assessment.stale && !data.acknowledgeStale) {
      return fail(
        assessment.kind === 'DOCUMENT'
          ? `The document has changed since this was proposed (it was written against version ${proposal.baseVersion}; the latest is ${assessment.latestVersion}). Compare it with the current version, then approve anyway if it should replace it.`
          : 'The project details have changed since this was proposed. Compare them with the current values, then approve anyway if it should apply.',
        { code: 'STALE' },
      )
    }

    const proposer = proposal.proposedBy?.name ?? 'a former member'
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.projectChangeProposal.updateMany({
        where: { id: proposal.id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), reviewNote: data.note || null },
      })
      if (claimed.count === 0) throw new ConflictError('Someone has just reviewed this proposal.')

      let version: number | undefined
      let target: string
      if (proposal.kind === 'DOCUMENT') {
        const payload = proposal.payload as unknown as DocumentPayload
        const key = proposal.documentKey ?? ''
        target = targetLabel('DOCUMENT', key, payload.title)
        const written = await writeDocumentVersion(tx, {
          projectId: proposal.projectId,
          key,
          title: payload.title,
          body: payload.body,
          source: 'PROPOSAL',
          authorId: proposal.proposedById,
          actorId: actor.id,
          summary: (next) => `approved ${proposer}'s proposal: version ${next} of ${target}`,
        })
        version = written.version
        await tx.projectChangeProposal.update({ where: { id: proposal.id }, data: { appliedVersion: version } })
      } else {
        target = 'the project details'
        const payload = proposal.payload as DetailsPayload
        const before = await tx.project.findUniqueOrThrow({
          where: { id: proposal.projectId },
          select: { name: true, description: true, status: true, startDate: true, endDate: true, ownerId: true },
        })
        const merged = { ...detailValues(before), ...payload }
        // Through the details form's own schema, so an approval is held to
        // exactly the rules a person's edit is.
        const details = updateProjectSchema.parse({
          id: proposal.projectId,
          name: before.name,
          ownerId: before.ownerId,
          description: merged.description ?? '',
          status: merged.status,
          startDate: merged.startDate,
          endDate: merged.endDate,
        })
        await writeProjectDetails(tx, { actorId: actor.id, data: details, before, proposedBy: proposer })
      }

      await notify(tx, {
        userIds: proposal.proposedById ? [proposal.proposedById] : [],
        type: 'PROPOSAL_REVIEWED',
        actorId: actor.id,
        title: `${actor.name} approved your proposed change to ${target}`,
        body: data.note ? preview(data.note) : null,
        link: proposalPath(proposal.projectId, proposal.id),
      })
      return { version }
    })

    // An approved document is now something the project knows.
    if (proposal.kind === 'DOCUMENT') {
      await enqueue('memory.index', { projectId: proposal.projectId }, { dedupeKey: `memory:${proposal.projectId}` })
    }
    revalidatePath(`/projects/${proposal.projectId}`, 'layout')
    revalidatePath('/projects')
    return ok(result)
  })
}

/** Rejects a proposal. It is kept, with the note, for the record. */
export async function rejectProposalAction(input: ReviewProposalInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = reviewProposalSchema.parse(input)
    const { proposal, actor } = await loadForReview(data.proposalId)
    if (proposal.status !== 'PENDING') return fail(ALREADY[proposal.status] ?? 'This proposal is no longer pending.', { code: 'CONFLICT' })

    const proposer = proposal.proposedBy?.name ?? 'a former member'
    const payload = proposal.payload as Partial<DocumentPayload>
    const target = targetLabel(proposal.kind, proposal.documentKey, payload.title)

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.projectChangeProposal.updateMany({
        where: { id: proposal.id, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), reviewNote: data.note || null },
      })
      if (claimed.count === 0) throw new ConflictError('Someone has just reviewed this proposal.')

      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'PROJECT',
        entityId: proposal.projectId,
        projectId: proposal.projectId,
        actorId: actor.id,
        field: 'proposal',
        newValue: proposal.id,
        summary: `rejected ${proposer}'s proposed change to ${target}`,
      })
      await notify(tx, {
        userIds: proposal.proposedById ? [proposal.proposedById] : [],
        type: 'PROPOSAL_REVIEWED',
        actorId: actor.id,
        title: `${actor.name} rejected your proposed change to ${target}`,
        body: data.note ? preview(data.note) : null,
        link: proposalPath(proposal.projectId, proposal.id),
      })
    })

    revalidatePath(`/projects/${proposal.projectId}`, 'layout')
    return ok()
  })
}

