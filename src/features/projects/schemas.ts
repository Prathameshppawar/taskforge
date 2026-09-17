import { z } from 'zod'

const projectCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Use at least 2 characters.')
  .max(10, 'Use 10 characters or fewer.')
  .regex(/^[A-Z][A-Z0-9]*$/, 'Start with a letter; use only letters and numbers.')

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a project name.').max(100),
    code: projectCode,
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED']).default('PLANNING'),
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
    ownerId: z.string().min(1, 'Choose an owner.'),
    templateId: z.string().min(1, 'Choose a template.'),
    /** Also create the template's default parent/child ticket scaffold. */
    includeTemplateTickets: z.boolean().default(true),
    color: z.string().default('indigo'),
    memberIds: z.array(z.string()).default([]),
  })
  .refine(
    (data) => !data.startDate || !data.endDate || data.endDate >= data.startDate,
    { message: 'The end date must be on or after the start date.', path: ['endDate'] },
  )
export type CreateProjectInput = z.infer<typeof createProjectSchema>

export const updateProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(2, 'Enter a project name.').max(100),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']),
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
    ownerId: z.string().min(1, 'Choose an owner.'),
  })
  .refine(
    (data) => !data.startDate || !data.endDate || data.endDate >= data.startDate,
    { message: 'The end date must be on or after the start date.', path: ['endDate'] },
  )
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

export const projectSettingsSchema = z.object({
  projectId: z.string().min(1),
  color: z.string().min(1),
  icon: z.string().min(1),
  autoStatusRollup: z.boolean(),
  allowSubtasks: z.boolean(),
  requireDueDate: z.boolean(),
  isPrivate: z.boolean(),
  defaultAssigneeId: z.string().nullable().optional(),
})
export type ProjectSettingsInput = z.infer<typeof projectSettingsSchema>

export const archiveProjectSchema = z.object({
  projectId: z.string().min(1),
  isArchived: z.boolean(),
})
export type ArchiveProjectInput = z.infer<typeof archiveProjectSchema>

export const addMemberSchema = z.object({
  projectId: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1, 'Choose at least one person.'),
  role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']).default('MEMBER'),
})
export type AddMemberInput = z.infer<typeof addMemberSchema>

export const updateMemberRoleSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']),
})
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>

export const removeMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
})
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>

// --- workflow configuration ---------------------------------------------------

export const statusSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a name.').max(40),
  category: z.enum([
    'BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED',
  ]),
  color: z.string().min(1),
  isInitial: z.boolean().default(false),
})
export type StatusInput = z.infer<typeof statusSchema>

export const prioritySchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a name.').max(40),
  color: z.string().min(1),
  level: z.coerce.number().int().min(1).max(99),
  isDefault: z.boolean().default(false),
})
export type PriorityInput = z.infer<typeof prioritySchema>

export const ticketTypeSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a name.').max(40),
  color: z.string().min(1),
  icon: z.string().min(1).default('circle-dot'),
  isDefault: z.boolean().default(false),
})
export type TicketTypeInput = z.infer<typeof ticketTypeSchema>

export const reorderSchema = z.object({
  projectId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)),
})
export type ReorderInput = z.infer<typeof reorderSchema>

export const deleteConfigSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  /** Where to move tickets currently using the deleted value. */
  replacementId: z.string().min(1),
})
export type DeleteConfigInput = z.infer<typeof deleteConfigSchema>
