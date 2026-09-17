import type { StatusCategory } from '@prisma/client'
import { BusinessRuleError } from './errors'

/**
 * Ticket hierarchy and progress rules.
 *
 * Hierarchy:  Project -> Parent Ticket (feature) -> Child Ticket (task)
 * Depth is capped at exactly two levels. A ticket that already has children
 * cannot become a child itself, and a child cannot be given children.
 */
export const MAX_HIERARCHY_DEPTH = 2

/** Status categories that count as "finished" for rollup and dashboards. */
export const TERMINAL_CATEGORIES: ReadonlySet<StatusCategory> = new Set<StatusCategory>([
  'DONE',
  'CANCELLED',
])

/** Categories that count toward completion percentage (CANCELLED does not). */
export const COMPLETED_CATEGORIES: ReadonlySet<StatusCategory> = new Set<StatusCategory>(['DONE'])

export function isTerminal(category: StatusCategory): boolean {
  return TERMINAL_CATEGORIES.has(category)
}

export function isCompleted(category: StatusCategory): boolean {
  return COMPLETED_CATEGORIES.has(category)
}

export interface HierarchyCandidate {
  ticketId: string
  /** The prospective parent. Null clears the relationship. */
  parentId: string | null
  /** Whether the ticket being moved currently has children. */
  hasChildren: boolean
  /** Whether the prospective parent is itself a child of something. */
  parentIsChild: boolean
  /** Project of the ticket being moved. */
  projectId: string
  /** Project of the prospective parent. */
  parentProjectId?: string
}

/**
 * Validates a parent assignment. Throws BusinessRuleError with a message that
 * is safe to surface directly in the UI.
 */
export function assertValidParent(candidate: HierarchyCandidate): void {
  const { ticketId, parentId, hasChildren, parentIsChild, projectId, parentProjectId } = candidate

  if (parentId === null) return

  if (parentId === ticketId) {
    throw new BusinessRuleError('A ticket cannot be its own parent.')
  }

  if (parentProjectId && parentProjectId !== projectId) {
    throw new BusinessRuleError('A parent ticket must belong to the same project.')
  }

  if (parentIsChild) {
    throw new BusinessRuleError(
      'That ticket is already a child ticket. The hierarchy is limited to two levels: parent → child.',
    )
  }

  if (hasChildren) {
    throw new BusinessRuleError(
      'This ticket already has child tickets, so it cannot become a child itself.',
    )
  }
}

export interface ChildProgressInput {
  statusCategory: StatusCategory
}

export interface RollupResult {
  total: number
  completed: number
  cancelled: number
  inProgress: number
  blocked: number
  /** 0–100, rounded. Cancelled children are excluded from the denominator. */
  completionPercent: number
  /** Suggested category for the parent, or null to leave it alone. */
  suggestedCategory: StatusCategory | null
}

/**
 * Rolls a parent's progress up from its children.
 *
 * Rules:
 *   • Cancelled children are excluded from the completion denominator.
 *   • All children done            -> parent DONE
 *   • Any child blocked            -> parent BLOCKED
 *   • Any child started/finished   -> parent IN_PROGRESS
 *   • Nothing started              -> no suggestion (leave the parent as-is)
 */
export function rollupProgress(children: ChildProgressInput[]): RollupResult {
  const total = children.length

  if (total === 0) {
    return {
      total: 0,
      completed: 0,
      cancelled: 0,
      inProgress: 0,
      blocked: 0,
      completionPercent: 0,
      suggestedCategory: null,
    }
  }

  let completed = 0
  let cancelled = 0
  let inProgress = 0
  let blocked = 0

  for (const child of children) {
    switch (child.statusCategory) {
      case 'DONE':
        completed++
        break
      case 'CANCELLED':
        cancelled++
        break
      case 'BLOCKED':
        blocked++
        break
      case 'IN_PROGRESS':
      case 'REVIEW':
        inProgress++
        break
      default:
        break
    }
  }

  const countable = total - cancelled
  const completionPercent = countable <= 0 ? 100 : Math.round((completed / countable) * 100)

  let suggestedCategory: StatusCategory | null = null
  if (countable > 0 && completed === countable) {
    suggestedCategory = 'DONE'
  } else if (blocked > 0) {
    suggestedCategory = 'BLOCKED'
  } else if (inProgress > 0 || completed > 0) {
    suggestedCategory = 'IN_PROGRESS'
  }

  return { total, completed, cancelled, inProgress, blocked, completionPercent, suggestedCategory }
}

/** Presentation order for Kanban columns and status pickers. */
export const CATEGORY_ORDER: Record<StatusCategory, number> = {
  BACKLOG: 0,
  TODO: 1,
  IN_PROGRESS: 2,
  BLOCKED: 3,
  REVIEW: 4,
  DONE: 5,
  CANCELLED: 6,
}

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}

/** Builds the display key for a ticket, e.g. AUTH-14. */
export function buildTicketKey(projectCode: string, number: number): string {
  return `${projectCode}-${number}`
}

const TICKET_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/i

export function parseTicketKey(value: string): { code: string; number: number } | null {
  const match = TICKET_KEY_PATTERN.exec(value.trim())
  if (!match) return null
  return { code: match[1].toUpperCase(), number: Number(match[2]) }
}
