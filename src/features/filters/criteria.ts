import type { FilterField, FilterOperator, Prisma } from '@prisma/client'

import { ticketFiltersSchema, type TicketFilters } from './types'

/**
 * Conversion between the flat filter object the UI uses and the normalized
 * criterion rows stored in the database.
 *
 * Kept out of actions.ts because a "use server" module may only export async
 * functions — these are pure and synchronous.
 */

/** Flattens a filter object into criterion rows, one per value. */
export function toCriteria(
  filters: TicketFilters,
): Prisma.SavedFilterCriterionCreateManySavedFilterInput[] {
  const rows: Array<{ field: FilterField; operator: FilterOperator; value: string }> = []

  const pushMany = (field: FilterField, values: string[]) => {
    for (const value of values) rows.push({ field, operator: 'IN', value })
  }

  pushMany('PROJECT', filters.projectIds)
  pushMany('ASSIGNEE', filters.assigneeIds)
  pushMany('REPORTER', filters.reporterIds)
  pushMany('STATUS', filters.statusIds)
  pushMany('STATUS_CATEGORY', filters.statusCategories)
  pushMany('PRIORITY', filters.priorityIds)
  pushMany('TYPE', filters.typeIds)
  pushMany('LABEL', filters.labelIds)

  if (filters.parentId) rows.push({ field: 'PARENT', operator: 'EQUALS', value: filters.parentId })
  if (filters.search) rows.push({ field: 'SEARCH', operator: 'CONTAINS', value: filters.search })
  if (filters.dueFrom) {
    rows.push({ field: 'DUE_DATE', operator: 'AFTER', value: filters.dueFrom.toISOString() })
  }
  if (filters.dueTo) {
    rows.push({ field: 'DUE_DATE', operator: 'BEFORE', value: filters.dueTo.toISOString() })
  }
  // Sentinel: "overdue" means "due before whenever the filter is evaluated",
  // which cannot be stored as a fixed date.
  if (filters.overdueOnly) rows.push({ field: 'DUE_DATE', operator: 'BEFORE', value: 'now' })
  if (filters.unassignedOnly) {
    rows.push({ field: 'ASSIGNEE', operator: 'IS_NULL', value: 'null' })
  }

  return rows.map((row, index) => ({ ...row, position: index }))
}

/** Rebuilds a filter object from its stored criterion rows. */
export function fromCriteria(
  criteria: Array<{ field: FilterField; operator: FilterOperator; value: string }>,
  sortBy: string,
  sortDir: string,
): TicketFilters {
  const collect = (field: FilterField) =>
    criteria.filter((c) => c.field === field && c.operator === 'IN').map((c) => c.value)

  const search = criteria.find((c) => c.field === 'SEARCH')?.value
  const parent = criteria.find((c) => c.field === 'PARENT')?.value
  const overdue = criteria.some((c) => c.field === 'DUE_DATE' && c.value === 'now')
  const unassigned = criteria.some((c) => c.field === 'ASSIGNEE' && c.operator === 'IS_NULL')

  const dueFrom = criteria.find(
    (c) => c.field === 'DUE_DATE' && c.operator === 'AFTER' && c.value !== 'now',
  )?.value
  const dueTo = criteria.find(
    (c) => c.field === 'DUE_DATE' && c.operator === 'BEFORE' && c.value !== 'now',
  )?.value

  return ticketFiltersSchema.parse({
    projectIds: collect('PROJECT'),
    assigneeIds: collect('ASSIGNEE'),
    reporterIds: collect('REPORTER'),
    statusIds: collect('STATUS'),
    statusCategories: collect('STATUS_CATEGORY'),
    priorityIds: collect('PRIORITY'),
    typeIds: collect('TYPE'),
    labelIds: collect('LABEL'),
    parentId: parent,
    search,
    dueFrom,
    dueTo,
    overdueOnly: overdue,
    unassignedOnly: unassigned,
    sortBy,
    sortDir,
  })
}
