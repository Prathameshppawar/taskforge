import { z } from 'zod'

import { PROPOSABLE_PROJECT_STATUSES } from '@/core/domain/project-documents'
import { documentBody, documentTitle } from '@/features/documents/schemas'

/** YYYY-MM-DD that is a real day, or "none" to clear the date. */
const dateOrNone = z
  .string()
  .trim()
  .refine(
    (value) =>
      value.toLowerCase() === 'none' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)),
    'Use a date as YYYY-MM-DD, or "none" to clear it.',
  )

const why = {
  summary: z.string().trim().max(300).optional(),
  rationale: z.string().trim().max(2000).optional(),
}

/** A proposed change to a project's description, status or dates. */
export const proposeProjectDetailsSchema = z
  .object({
    projectId: z.string().min(1),
    // The same limit as the details form, so an approval cannot fail on length.
    description: z.string().trim().max(2000).optional(),
    status: z.enum(PROPOSABLE_PROJECT_STATUSES).optional(),
    startDate: dateOrNone.optional(),
    endDate: dateOrNone.optional(),
    ...why,
  })
  .refine(
    (data) => [data.description, data.status, data.startDate, data.endDate].some((value) => value !== undefined),
    { message: 'Propose at least one of description, status, start date or end date.' },
  )
export type ProposeProjectDetailsInput = z.infer<typeof proposeProjectDetailsSchema>

/** A proposed new document, or a new version of one — the handbook included. */
export const proposeDocumentSchema = z.object({
  projectId: z.string().min(1),
  /** A document's name or key: "Architecture", "support-runbook", "handbook". */
  name: z.string().trim().min(1).max(120),
  title: documentTitle.optional(),
  body: documentBody,
  /** The version the proposer read; the latest when omitted. 0 for a new document. */
  baseVersion: z.number().int().min(0).optional(),
  ...why,
})
export type ProposeDocumentInput = z.infer<typeof proposeDocumentSchema>

/**
 * Validation failures as one sentence an agent can act on. Proposals mostly
 * arrive from a model, which has no form to highlight fields in.
 */
export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join('; ')
}

export const reviewProposalSchema = z.object({
  proposalId: z.string().min(1),
  note: z.string().trim().max(2000).optional(),
  /** Approve although the target changed after the proposal was written. */
  acknowledgeStale: z.boolean().optional(),
})
export type ReviewProposalInput = z.infer<typeof reviewProposalSchema>
