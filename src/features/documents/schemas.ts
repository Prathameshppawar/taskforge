import { z } from 'zod'

import { DOCUMENT_LIMITS } from '@/core/domain/project-documents'

export const documentBody = z
  .string()
  .trim()
  .min(DOCUMENT_LIMITS.bodyMin, `Write at least ${DOCUMENT_LIMITS.bodyMin} characters.`)
  .max(DOCUMENT_LIMITS.bodyMax, `Keep it under ${DOCUMENT_LIMITS.bodyMax.toLocaleString('en')} characters.`)

export const documentTitle = z.string().trim().min(2, 'Give it a title.').max(DOCUMENT_LIMITS.titleMax)

/**
 * A person saving a document. `key` names an existing document, which gets a
 * new version; without it, `title` names a new one and its key is derived.
 */
export const saveDocumentSchema = z
  .object({
    projectId: z.string().min(1),
    key: z.string().min(1).max(80).optional(),
    title: documentTitle.optional(),
    body: documentBody,
  })
  .refine((data) => data.key || data.title, { message: 'Name the document.', path: ['title'] })

export type SaveDocumentInput = z.infer<typeof saveDocumentSchema>
