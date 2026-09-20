import { z } from 'zod'

const resourceType = z.enum([
  'GITHUB', 'SHAREPOINT', 'FIGMA', 'BUILD', 'DOCUMENTATION', 'API_SPEC', 'OTHER',
])

export const resourceInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Enter a name.').max(100),
  type: resourceType.default('OTHER'),
  url: z.string().trim().url('Enter a valid URL (including https://).').max(2000),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
})
export type ResourceInput = z.infer<typeof resourceInputSchema>

export const createTicketSchema = z.object({
  projectId: z.string().min(1, 'Choose a project.'),
  title: z.string().trim().min(3, 'Enter a title of at least 3 characters.').max(200),
  description: z.string().trim().max(10_000).optional().or(z.literal('')),
  remarks: z.string().trim().max(2000).optional().or(z.literal('')),
  statusId: z.string().optional(),
  priorityId: z.string().optional(),
  typeId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  labelIds: z.array(z.string()).default([]),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  estimateHours: z.coerce.number().min(0).max(9999).nullable().optional(),
  storyPoints: z.coerce.number().int().min(0).max(999).nullable().optional(),
  resources: z.array(resourceInputSchema).default([]),
})
export type CreateTicketInput = z.infer<typeof createTicketSchema>

export const updateTicketSchema = z.object({
  id: z.string().min(1),
  /**
   * The ticket's `updatedAt` as the client last saw it.
   *
   * Optional, because inline controls that change exactly one field cannot
   * clobber anything meaningful. Forms that edit prose supply it, so two people
   * rewriting the same description are told rather than one silently winning.
   */
  expectedUpdatedAt: z.coerce.date().optional(),
  title: z.string().trim().min(3, 'Enter a title of at least 3 characters.').max(200).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  statusId: z.string().optional(),
  priorityId: z.string().optional(),
  typeId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  estimateHours: z.coerce.number().min(0).max(9999).nullable().optional(),
  storyPoints: z.coerce.number().int().min(0).max(999).nullable().optional(),
})
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>

/** Kanban drag-and-drop: move a ticket to a column at a given position. */
export const moveTicketSchema = z.object({
  ticketId: z.string().min(1),
  statusId: z.string().min(1),
  /** Neighbouring positions in the destination column, for midpoint ordering. */
  beforePosition: z.number().nullable().optional(),
  afterPosition: z.number().nullable().optional(),
})
export type MoveTicketInput = z.infer<typeof moveTicketSchema>

export const archiveTicketSchema = z.object({
  ticketId: z.string().min(1),
  isArchived: z.boolean(),
})
export type ArchiveTicketInput = z.infer<typeof archiveTicketSchema>

export const deleteTicketSchema = z.object({
  ticketId: z.string().min(1),
})
export type DeleteTicketInput = z.infer<typeof deleteTicketSchema>

/** Bulk edits from the table view's selection toolbar. */
export const bulkUpdateSchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1, 'Select at least one ticket.'),
  statusId: z.string().optional(),
  priorityId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  addLabelIds: z.array(z.string()).default([]),
  removeLabelIds: z.array(z.string()).default([]),
})
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>

// --- resources ----------------------------------------------------------------

export const addResourceSchema = resourceInputSchema.extend({
  ticketId: z.string().min(1),
})
export type AddResourceInput = z.infer<typeof addResourceSchema>

export const removeResourceSchema = z.object({
  resourceId: z.string().min(1),
})
export type RemoveResourceInput = z.infer<typeof removeResourceSchema>

// --- comments -----------------------------------------------------------------

export const createCommentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(1, 'Write a comment.').max(5000),
  parentId: z.string().nullable().optional(),
})
export type CreateCommentInput = z.infer<typeof createCommentSchema>

export const updateCommentSchema = z.object({
  commentId: z.string().min(1),
  body: z.string().trim().min(1, 'Write a comment.').max(5000),
})
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>

export const deleteCommentSchema = z.object({
  commentId: z.string().min(1),
})
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>

// --- bulk creation (used by the AI Copilot and the "add children" dialog) -----

export const bulkCreateSchema = z.object({
  projectId: z.string().min(1),
  parent: z.object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(10_000).optional().or(z.literal('')),
    typeId: z.string().optional(),
    priorityId: z.string().optional(),
    labelIds: z.array(z.string()).default([]),
  }),
  children: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().max(10_000).optional().or(z.literal('')),
        typeId: z.string().optional(),
        priorityId: z.string().optional(),
        assigneeId: z.string().nullable().optional(),
        labelIds: z.array(z.string()).default([]),
      }),
    )
    .min(1, 'Add at least one child ticket.')
    .max(50, 'Create at most 50 child tickets at a time.'),
})
export type BulkCreateInput = z.infer<typeof bulkCreateSchema>

/** Attach children to an existing parent. */
export const addChildrenSchema = z.object({
  parentId: z.string().min(1),
  titles: z.array(z.string().trim().min(3).max(200)).min(1).max(50),
})
export type AddChildrenInput = z.infer<typeof addChildrenSchema>

/** Linking two tickets. The pair and direction are validated in the service. */
export const linkTicketSchema = z.object({
  ticketKey: z.string().trim().min(1),
  targetKey: z.string().trim().min(1, 'Enter a ticket key, e.g. RC-14'),
  type: z.enum(['BLOCKS', 'RELATES_TO', 'DUPLICATES']),
})
export type LinkTicketInput = z.infer<typeof linkTicketSchema>
