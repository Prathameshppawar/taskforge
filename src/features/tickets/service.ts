import type { Prisma } from '@prisma/client'

import {
  assertValidParent,
  isCompleted,
  isTerminal,
  rollupProgress,
} from '@/core/domain/ticket-rules'
import { NotFoundError } from '@/core/domain/errors'
import { recordActivity } from '@/features/activity/service'

/**
 * Ticket domain operations that need database access.
 *
 * Every function here takes a transaction client: hierarchy validation, rollup
 * and the audit entry must all commit together with the change that triggered
 * them.
 */

type Tx = Prisma.TransactionClient

/**
 * Validates a prospective parent against the two-level hierarchy rule, loading
 * only what the rule needs.
 */
export async function validateParentAssignment(
  tx: Tx,
  ticketId: string,
  parentId: string | null,
  projectId: string,
): Promise<void> {
  if (parentId === null) return

  const [parent, childCount] = await Promise.all([
    tx.ticket.findUnique({
      where: { id: parentId },
      select: { id: true, projectId: true, parentId: true },
    }),
    tx.ticket.count({ where: { parentId: ticketId } }),
  ])

  if (!parent) throw new NotFoundError('Parent ticket', parentId)

  assertValidParent({
    ticketId,
    parentId,
    hasChildren: childCount > 0,
    parentIsChild: parent.parentId !== null,
    projectId,
    parentProjectId: parent.projectId,
  })
}

export interface RollupOutcome {
  completionPercent: number
  statusChanged: boolean
  newStatusName?: string
}

/**
 * Recomputes a parent's progress from its children and, when the project has
 * `autoStatusRollup` enabled, advances the parent's status to match.
 *
 * Called after any change to a child's status. Safe to call with a ticket that
 * has no children — it simply does nothing.
 */
export async function applyParentRollup(
  tx: Tx,
  parentId: string,
  actorId: string,
): Promise<RollupOutcome | null> {
  const parent = await tx.ticket.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      key: true,
      projectId: true,
      statusId: true,
      status: { select: { id: true, name: true, category: true } },
      project: { select: { settings: { select: { autoStatusRollup: true } } } },
    },
  })

  if (!parent) return null

  const children = await tx.ticket.findMany({
    where: { parentId, isArchived: false },
    select: { status: { select: { category: true } } },
  })

  if (children.length === 0) return null

  const rollup = rollupProgress(
    children.map((child) => ({ statusCategory: child.status.category })),
  )

  if (!parent.project.settings?.autoStatusRollup) {
    return { completionPercent: rollup.completionPercent, statusChanged: false }
  }

  if (!rollup.suggestedCategory || rollup.suggestedCategory === parent.status.category) {
    return { completionPercent: rollup.completionPercent, statusChanged: false }
  }

  // Map the suggested category onto a concrete status in this project. The
  // lowest-position status in the category is used, so a project with several
  // review-like columns lands on the first of them.
  const target = await tx.status.findFirst({
    where: { projectId: parent.projectId, category: rollup.suggestedCategory },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, category: true },
  })

  if (!target || target.id === parent.statusId) {
    return { completionPercent: rollup.completionPercent, statusChanged: false }
  }

  await tx.ticket.update({
    where: { id: parentId },
    data: {
      statusId: target.id,
      completedAt: isCompleted(target.category) ? new Date() : null,
    },
  })

  await recordActivity(tx, {
    action: 'STATUS_CHANGED',
    entityType: 'TICKET',
    entityId: parentId,
    entityLabel: parent.key,
    projectId: parent.projectId,
    ticketId: parentId,
    actorId,
    field: 'status',
    oldValue: parent.status.name,
    newValue: target.name,
    summary: `rolled ${parent.key} up to ${target.name} (${rollup.completionPercent}% of children complete)`,
  })

  return {
    completionPercent: rollup.completionPercent,
    statusChanged: true,
    newStatusName: target.name,
  }
}

/**
 * Sets or clears `completedAt` when a ticket enters or leaves a terminal status.
 * Returns the value to persist.
 */
export function resolveCompletedAt(
  categoryAfter: string,
  currentCompletedAt: Date | null,
): Date | null {
  const terminal = isTerminal(categoryAfter as never)
  if (terminal) return currentCompletedAt ?? new Date()
  return null
}

/** Reconciles a ticket's labels to exactly `labelIds`, auditing each change. */
export async function syncTicketLabels(
  tx: Tx,
  args: {
    ticketId: string
    ticketKey: string
    projectId: string
    labelIds: string[]
    actorId: string
  },
): Promise<void> {
  const current = await tx.ticketLabel.findMany({
    where: { ticketId: args.ticketId },
    select: { labelId: true, label: { select: { name: true } } },
  })

  const currentIds = new Set(current.map((l) => l.labelId))
  const nextIds = new Set(args.labelIds)

  const toAdd = args.labelIds.filter((id) => !currentIds.has(id))
  const toRemove = current.filter((l) => !nextIds.has(l.labelId))

  if (toAdd.length === 0 && toRemove.length === 0) return

  if (toRemove.length > 0) {
    await tx.ticketLabel.deleteMany({
      where: { ticketId: args.ticketId, labelId: { in: toRemove.map((l) => l.labelId) } },
    })
  }

  if (toAdd.length > 0) {
    // Only labels belonging to this project may be attached.
    const valid = await tx.label.findMany({
      where: { id: { in: toAdd }, projectId: args.projectId },
      select: { id: true, name: true },
    })

    if (valid.length > 0) {
      await tx.ticketLabel.createMany({
        data: valid.map((label) => ({ ticketId: args.ticketId, labelId: label.id })),
        skipDuplicates: true,
      })

      for (const label of valid) {
        await recordActivity(tx, {
          action: 'LABEL_ADDED',
          entityType: 'TICKET',
          entityId: args.ticketId,
          entityLabel: args.ticketKey,
          projectId: args.projectId,
          ticketId: args.ticketId,
          actorId: args.actorId,
          field: 'labels',
          newValue: label.name,
          summary: `added label ${label.name} to ${args.ticketKey}`,
        })
      }
    }
  }

  for (const removed of toRemove) {
    await recordActivity(tx, {
      action: 'LABEL_REMOVED',
      entityType: 'TICKET',
      entityId: args.ticketId,
      entityLabel: args.ticketKey,
      projectId: args.projectId,
      ticketId: args.ticketId,
      actorId: args.actorId,
      field: 'labels',
      oldValue: removed.label.name,
      summary: `removed label ${removed.label.name} from ${args.ticketKey}`,
    })
  }
}

/** Extracts @mentions from comment text and resolves them to active users. */
export async function resolveMentions(
  tx: Tx,
  body: string,
): Promise<Array<{ id: string; username: string }>> {
  const usernames = [...body.matchAll(/@([a-z0-9._-]{3,32})/gi)].map((m) => m[1].toLowerCase())
  if (usernames.length === 0) return []

  return tx.user.findMany({
    where: { username: { in: [...new Set(usernames)] }, isActive: true },
    select: { id: true, username: true },
  })
}
