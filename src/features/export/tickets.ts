import type { Actor } from '@/features/auth/guards'
import { listTickets, type TicketListItem } from '@/features/tickets/queries'
import type { TicketFilters } from '@/features/filters/types'
import type { ExportColumn } from './service'

/**
 * Exporting the view somebody is looking at.
 *
 * It goes through `listTickets` rather than its own query, which is the whole
 * security argument: the same visibility filter, the same project scope, the
 * same everything. An export endpoint with a bespoke query is how a tool ends
 * up with one place where RBAC quietly does not apply.
 */

/**
 * A ceiling, because a browser download has no progress bar and a request has a
 * timeout. Filtered views are far below it; "everything, ever" is the case this
 * exists for, and it tells the user rather than silently truncating.
 */
export const EXPORT_LIMIT = 5000

export const TICKET_COLUMNS: ReadonlyArray<ExportColumn<TicketListItem>> = [
  { key: 'key', header: 'Key', width: 12, value: (t) => t.key },
  { key: 'title', header: 'Title', width: 50, value: (t) => t.title },
  { key: 'status', header: 'Status', width: 16, value: (t) => t.status.name },
  { key: 'category', header: 'Status category', width: 16, value: (t) => t.status.category },
  { key: 'priority', header: 'Priority', width: 12, value: (t) => t.priority.name },
  { key: 'type', header: 'Type', width: 12, value: (t) => t.type.name },
  { key: 'assignee', header: 'Assignee', width: 20, value: (t) => t.assignee?.name ?? '' },
  { key: 'reporter', header: 'Reporter', width: 20, value: (t) => t.reporter?.name ?? '' },
  {
    key: 'labels',
    header: 'Labels',
    width: 28,
    value: (t) => t.labels.map((entry) => entry.label.name).join(', '),
  },
  { key: 'parent', header: 'Parent', width: 12, value: (t) => t.parent?.key ?? '' },
  { key: 'project', header: 'Project', width: 20, value: (t) => t.project.name },
  { key: 'points', header: 'Story points', width: 12, value: (t) => t.storyPoints ?? '' },
  { key: 'estimate', header: 'Estimate (h)', width: 12, value: (t) => t.estimateHours ?? '' },
  { key: 'start', header: 'Start date', width: 12, value: (t) => t.startDate },
  { key: 'due', header: 'Due date', width: 12, value: (t) => t.dueDate },
  { key: 'completed', header: 'Completed', width: 12, value: (t) => t.completedAt },
  { key: 'created', header: 'Created', width: 12, value: (t) => t.createdAt },
  { key: 'updated', header: 'Updated', width: 12, value: (t) => t.updatedAt },
]

export interface ExportResult {
  rows: TicketListItem[]
  total: number
  truncated: boolean
}

export async function collectTickets(
  actor: Actor,
  filters: TicketFilters,
  projectId?: string,
): Promise<ExportResult> {
  const { items, total } = await listTickets(actor, filters, {
    projectId,
    take: EXPORT_LIMIT,
  })

  return { rows: items, total, truncated: total > items.length }
}

/** The subset of columns to include, defaulting to all of them. */
export function selectColumns(
  requested: string[] | undefined,
): ReadonlyArray<ExportColumn<TicketListItem>> {
  if (!requested || requested.length === 0) return TICKET_COLUMNS

  const wanted = new Set(requested)
  const chosen = TICKET_COLUMNS.filter((column) => wanted.has(column.key))

  // An unrecognised selection yields everything rather than an empty file,
  // which would look like the export silently failed.
  return chosen.length > 0 ? chosen : TICKET_COLUMNS
}
