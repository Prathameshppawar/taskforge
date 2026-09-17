import { z } from 'zod'

export const recurringSchema = z
  .object({
    id: z.string().optional(),
    projectId: z.string().min(1),
    name: z.string().trim().min(2, 'Name this schedule.').max(80),
    title: z.string().trim().min(3, 'Enter the ticket title.').max(200),
    description: z.string().trim().max(5000).optional().or(z.literal('')),
    statusId: z.string().min(1),
    priorityId: z.string().min(1),
    typeId: z.string().min(1),
    assigneeId: z.string().nullable().optional(),
    labelIds: z.array(z.string()).default([]),
    frequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
    interval: z.coerce.number().int().min(1).max(52).default(1),
    dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(),
    dueInDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine(
    (data) => !data.endDate || data.endDate >= data.startDate,
    { message: 'The end date must be on or after the start date.', path: ['endDate'] },
  )

export type RecurringInput = z.infer<typeof recurringSchema>

export const toggleRecurringSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
})
export type ToggleRecurringInput = z.infer<typeof toggleRecurringSchema>

export const deleteRecurringSchema = z.object({ id: z.string().min(1) })
export type DeleteRecurringInput = z.infer<typeof deleteRecurringSchema>
