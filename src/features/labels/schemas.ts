import { z } from 'zod'

export const createLabelSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a label name.').max(40),
  color: z.string().min(1).default('slate'),
  description: z.string().trim().max(200).optional().or(z.literal('')),
})
export type CreateLabelInput = z.infer<typeof createLabelSchema>

export const updateLabelSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a label name.').max(40),
  color: z.string().min(1),
  description: z.string().trim().max(200).optional().or(z.literal('')),
})
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>

export const deleteLabelSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
})
export type DeleteLabelInput = z.infer<typeof deleteLabelSchema>

export const importLabelsSchema = z.object({
  targetProjectId: z.string().min(1),
  sourceProjectId: z.string().min(1, 'Choose a project to import from.'),
  /** Empty = import every label from the source project. */
  labelIds: z.array(z.string()).default([]),
})
export type ImportLabelsInput = z.infer<typeof importLabelsSchema>
