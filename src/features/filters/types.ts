import { z } from 'zod'

/**
 * Filter contract shared by every view.
 *
 * The same object is produced by the URL (`?status=...&label=...`), by the
 * filter bar, by saved filter sets, and by the AI Copilot's search tool — so
 * all four paths hit one query builder.
 */
export const ticketFiltersSchema = z.object({
  projectIds: z.array(z.string()).default([]),
  assigneeIds: z.array(z.string()).default([]),
  reporterIds: z.array(z.string()).default([]),
  statusIds: z.array(z.string()).default([]),
  statusCategories: z
    .array(
      z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED']),
    )
    .default([]),
  priorityIds: z.array(z.string()).default([]),
  typeIds: z.array(z.string()).default([]),
  labelIds: z.array(z.string()).default([]),
  parentId: z.string().nullable().optional(),
  search: z.string().optional(),
  dueFrom: z.coerce.date().optional().nullable(),
  dueTo: z.coerce.date().optional().nullable(),
  createdFrom: z.coerce.date().optional().nullable(),
  createdTo: z.coerce.date().optional().nullable(),
  /** Only tickets past their due date and not finished. */
  overdueOnly: z.boolean().default(false),
  /** Only tickets with no assignee. */
  unassignedOnly: z.boolean().default(false),
  /** Exclude child tickets — useful for a feature-level roadmap. */
  parentsOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  sortBy: z
    .enum(['updatedAt', 'createdAt', 'dueDate', 'priority', 'status', 'title', 'key'])
    .default('updatedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

export type TicketFilters = z.infer<typeof ticketFiltersSchema>

export const EMPTY_FILTERS: TicketFilters = ticketFiltersSchema.parse({})

/** Reads filters out of a URLSearchParams-like record. */
export function parseFiltersFromParams(
  params: Record<string, string | string[] | undefined>,
): TicketFilters {
  const many = (key: string): string[] => {
    const value = params[key]
    if (!value) return []
    return Array.isArray(value) ? value : value.split(',').filter(Boolean)
  }

  const one = (key: string): string | undefined => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  return ticketFiltersSchema.parse({
    projectIds: many('project'),
    assigneeIds: many('assignee'),
    reporterIds: many('reporter'),
    statusIds: many('status'),
    statusCategories: many('category'),
    priorityIds: many('priority'),
    typeIds: many('type'),
    labelIds: many('label'),
    parentId: one('parent') ?? undefined,
    search: one('q') || undefined,
    dueFrom: one('dueFrom') || undefined,
    dueTo: one('dueTo') || undefined,
    createdFrom: one('createdFrom') || undefined,
    createdTo: one('createdTo') || undefined,
    overdueOnly: one('overdue') === '1',
    unassignedOnly: one('unassigned') === '1',
    parentsOnly: one('parentsOnly') === '1',
    includeArchived: one('archived') === '1',
    sortBy: one('sortBy') || undefined,
    sortDir: one('sortDir') || undefined,
  })
}

/** Serializes filters back into a query string for shareable URLs. */
export function filtersToSearchParams(filters: TicketFilters): URLSearchParams {
  const params = new URLSearchParams()
  const setMany = (key: string, values: string[]) => {
    if (values.length > 0) params.set(key, values.join(','))
  }

  setMany('project', filters.projectIds)
  setMany('assignee', filters.assigneeIds)
  setMany('reporter', filters.reporterIds)
  setMany('status', filters.statusIds)
  setMany('category', filters.statusCategories)
  setMany('priority', filters.priorityIds)
  setMany('type', filters.typeIds)
  setMany('label', filters.labelIds)

  if (filters.parentId) params.set('parent', filters.parentId)
  if (filters.search) params.set('q', filters.search)
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom.toISOString().slice(0, 10))
  if (filters.dueTo) params.set('dueTo', filters.dueTo.toISOString().slice(0, 10))
  if (filters.overdueOnly) params.set('overdue', '1')
  if (filters.unassignedOnly) params.set('unassigned', '1')
  if (filters.parentsOnly) params.set('parentsOnly', '1')
  if (filters.includeArchived) params.set('archived', '1')
  if (filters.sortBy !== 'updatedAt') params.set('sortBy', filters.sortBy)
  if (filters.sortDir !== 'desc') params.set('sortDir', filters.sortDir)

  return params
}

export function countActiveFilters(filters: TicketFilters): number {
  let count = 0
  count += filters.projectIds.length
  count += filters.assigneeIds.length
  count += filters.reporterIds.length
  count += filters.statusIds.length
  count += filters.statusCategories.length
  count += filters.priorityIds.length
  count += filters.typeIds.length
  count += filters.labelIds.length
  if (filters.parentId) count++
  if (filters.search) count++
  if (filters.dueFrom || filters.dueTo) count++
  if (filters.overdueOnly) count++
  if (filters.unassignedOnly) count++
  if (filters.parentsOnly) count++
  return count
}
