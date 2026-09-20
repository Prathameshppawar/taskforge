'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireActor, requireProjectPermission, can,
  requireProjectView,
} from '@/features/auth/guards'
import { allocateTicketNumber, loadProjectConfig } from '@/features/projects/service'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { buildTicketKey, isTerminal } from '@/core/domain/ticket-rules'
import { runAction } from '@/lib/safe-action'
import { notify, preview } from '@/features/notifications/service'
import { calculatePosition } from '@/lib/utils'
import {
  applyParentRollup,
  resolveMentions,
  syncTicketLabels,
  validateParentAssignment,
} from './service'
import { describeLink, ticketAudience, validateLink } from './relations'
import { suggestTriage, type TriageSuggestion } from './triage'
import {
  addChildrenSchema,
  addResourceSchema,
  archiveTicketSchema,
  bulkCreateSchema,
  bulkUpdateSchema,
  createCommentSchema,
  linkTicketSchema,
  type LinkTicketInput,
  createTicketSchema,
  deleteCommentSchema,
  deleteTicketSchema,
  moveTicketSchema,
  removeResourceSchema,
  updateCommentSchema,
  updateTicketSchema,
  type AddChildrenInput,
  type AddResourceInput,
  type ArchiveTicketInput,
  type BulkCreateInput,
  type BulkUpdateInput,
  type CreateCommentInput,
  type CreateTicketInput,
  type DeleteCommentInput,
  type DeleteTicketInput,
  type MoveTicketInput,
  type RemoveResourceInput,
  type UpdateCommentInput,
  type UpdateTicketInput,
} from './schemas'

/** Revalidates every route a ticket change can appear on. */
function revalidateTicket(projectId: string, ticketKey?: string) {
  revalidatePath(`/projects/${projectId}`, 'layout')
  revalidatePath('/my-tickets')
  revalidatePath('/dashboard')
  if (ticketKey) revalidatePath(`/tickets/${ticketKey}`)
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export async function createTicketAction(
  input: CreateTicketInput,
): Promise<ActionResult<{ id: string; key: string }>> {
  return runAction(async () => {
    const data = createTicketSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'ticket:create')

    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: {
        code: true,
        isArchived: true,
        settings: { select: { requireDueDate: true, allowSubtasks: true, defaultAssigneeId: true } },
      },
    })
    if (!project) throw new NotFoundError('Project', data.projectId)
    if (project.isArchived) {
      throw new BusinessRuleError('This project is archived. Restore it before adding tickets.')
    }
    if (project.settings?.requireDueDate && !data.dueDate) {
      return fail('This project requires a due date on every ticket.', {
        fieldErrors: { dueDate: ['A due date is required.'] },
      })
    }
    if (data.parentId && project.settings?.allowSubtasks === false) {
      throw new BusinessRuleError('Child tickets are disabled for this project.')
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const config = await loadProjectConfig(tx, data.projectId)

      const statusId = data.statusId ?? config.initialStatus?.id
      const priorityId = data.priorityId ?? config.defaultPriority?.id
      const typeId = data.typeId ?? config.defaultType?.id

      if (!statusId || !priorityId || !typeId) {
        throw new BusinessRuleError(
          'This project has no workflow configured. Add a status, priority and ticket type first.',
        )
      }

      if (data.parentId) {
        await validateParentAssignment(tx, 'new', data.parentId, data.projectId)
      }

      const number = await allocateTicketNumber(tx, data.projectId)
      const key = buildTicketKey(project.code, number)

      const status = config.statuses.find((s) => s.id === statusId)

      const created = await tx.ticket.create({
        data: {
          projectId: data.projectId,
          number,
          key,
          title: data.title,
          description: data.description || null,
          remarks: data.remarks || null,
          statusId,
          priorityId,
          typeId,
          assigneeId: data.assigneeId ?? project.settings?.defaultAssigneeId ?? null,
          reporterId: actor.id,
          parentId: data.parentId ?? null,
          dueDate: data.dueDate ?? null,
          startDate: data.startDate ?? null,
          estimateHours: data.estimateHours ?? null,
          storyPoints: data.storyPoints ?? null,
          completedAt: status && isTerminal(status.category) ? new Date() : null,
          position: number * 1000,
          createdById: actor.id,
          resources: data.resources.length
            ? {
                create: data.resources.map((resource) => ({
                  name: resource.name,
                  type: resource.type,
                  url: resource.url,
                  notes: resource.notes || null,
                  createdById: actor.id,
                })),
              }
            : undefined,
        },
        select: { id: true, key: true, title: true },
      })

      if (data.labelIds.length > 0) {
        await syncTicketLabels(tx, {
          ticketId: created.id,
          ticketKey: created.key,
          projectId: data.projectId,
          labelIds: data.labelIds,
          actorId: actor.id,
        })
      }

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'TICKET',
        entityId: created.id,
        entityLabel: created.key,
        projectId: data.projectId,
        ticketId: created.id,
        actorId: actor.id,
        summary: `created ${created.key} — ${created.title}`,
      })

      if (data.parentId) {
        await applyParentRollup(tx, data.parentId, actor.id)
      }

      return created
    })

    revalidateTicket(data.projectId, ticket.key)
    return ok({ id: ticket.id, key: ticket.key })
  })
}

/**
 * Creates one parent ticket plus its children in a single transaction.
 * Backs both the "break down a feature" dialog and the AI Copilot.
 */
export async function bulkCreateTicketsAction(
  input: BulkCreateInput,
): Promise<ActionResult<{ parentKey: string; childKeys: string[] }>> {
  return runAction(async () => {
    const data = bulkCreateSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'ticket:create')

    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { code: true, isArchived: true },
    })
    if (!project) throw new NotFoundError('Project', data.projectId)
    if (project.isArchived) {
      throw new BusinessRuleError('This project is archived. Restore it before adding tickets.')
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const config = await loadProjectConfig(tx, data.projectId)
        const statusId = config.initialStatus?.id
        const fallbackPriority = config.defaultPriority?.id
        const fallbackType = config.defaultType?.id

        if (!statusId || !fallbackPriority || !fallbackType) {
          throw new BusinessRuleError('This project has no workflow configured.')
        }

        const parentNumber = await allocateTicketNumber(tx, data.projectId)
        const parentKey = buildTicketKey(project.code, parentNumber)

        const parent = await tx.ticket.create({
          data: {
            projectId: data.projectId,
            number: parentNumber,
            key: parentKey,
            title: data.parent.title,
            description: data.parent.description || null,
            statusId,
            priorityId: data.parent.priorityId ?? fallbackPriority,
            typeId: data.parent.typeId ?? fallbackType,
            reporterId: actor.id,
            createdById: actor.id,
            position: parentNumber * 1000,
          },
          select: { id: true, key: true },
        })

        if (data.parent.labelIds.length > 0) {
          await syncTicketLabels(tx, {
            ticketId: parent.id,
            ticketKey: parent.key,
            projectId: data.projectId,
            labelIds: data.parent.labelIds,
            actorId: actor.id,
          })
        }

        const childKeys: string[] = []

        for (const child of data.children) {
          const number = await allocateTicketNumber(tx, data.projectId)
          const key = buildTicketKey(project.code, number)

          const createdChild = await tx.ticket.create({
            data: {
              projectId: data.projectId,
              number,
              key,
              title: child.title,
              description: child.description || null,
              statusId,
              priorityId: child.priorityId ?? fallbackPriority,
              typeId: child.typeId ?? fallbackType,
              assigneeId: child.assigneeId ?? null,
              parentId: parent.id,
              reporterId: actor.id,
              createdById: actor.id,
              position: number * 1000,
            },
            select: { id: true, key: true },
          })

          if (child.labelIds.length > 0) {
            await syncTicketLabels(tx, {
              ticketId: createdChild.id,
              ticketKey: createdChild.key,
              projectId: data.projectId,
              labelIds: child.labelIds,
              actorId: actor.id,
            })
          }

          childKeys.push(key)
        }

        await recordActivity(tx, {
          action: 'CREATED',
          entityType: 'TICKET',
          entityId: parent.id,
          entityLabel: parent.key,
          projectId: data.projectId,
          ticketId: parent.id,
          actorId: actor.id,
          summary: `created ${parent.key} with ${childKeys.length} child tickets`,
        })

        return { parentKey: parent.key, childKeys }
      },
      { timeout: 30_000 },
    )

    revalidateTicket(data.projectId)
    return ok(result)
  })
}

/** Adds children to an existing parent from a list of titles. */
export async function addChildTicketsAction(
  input: AddChildrenInput,
): Promise<ActionResult<{ created: number }>> {
  return runAction(async () => {
    const data = addChildrenSchema.parse(input)

    const parent = await prisma.ticket.findUnique({
      where: { id: data.parentId },
      select: {
        id: true,
        key: true,
        projectId: true,
        parentId: true,
        statusId: true,
        priorityId: true,
        typeId: true,
        project: { select: { code: true } },
      },
    })
    if (!parent) throw new NotFoundError('Ticket', data.parentId)

    const { actor } = await requireProjectPermission(parent.projectId, 'ticket:create')

    if (parent.parentId !== null) {
      throw new BusinessRuleError(
        'This is already a child ticket. The hierarchy is limited to two levels.',
      )
    }

    const created = await prisma.$transaction(
      async (tx) => {
        const config = await loadProjectConfig(tx, parent.projectId)
        const statusId = config.initialStatus?.id ?? parent.statusId
        const keys: string[] = []

        for (const title of data.titles) {
          const number = await allocateTicketNumber(tx, parent.projectId)
          const key = buildTicketKey(parent.project.code, number)

          await tx.ticket.create({
            data: {
              projectId: parent.projectId,
              number,
              key,
              title,
              statusId,
              priorityId: parent.priorityId,
              typeId: parent.typeId,
              parentId: parent.id,
              reporterId: actor.id,
              createdById: actor.id,
              position: number * 1000,
            },
          })
          keys.push(key)
        }

        await recordActivity(tx, {
          action: 'CREATED',
          entityType: 'TICKET',
          entityId: parent.id,
          entityLabel: parent.key,
          projectId: parent.projectId,
          ticketId: parent.id,
          actorId: actor.id,
          summary: `added ${keys.length} child tickets to ${parent.key}`,
        })

        await applyParentRollup(tx, parent.id, actor.id)

        return keys.length
      },
      { timeout: 30_000 },
    )

    revalidateTicket(parent.projectId, parent.key)
    return ok({ created })
  })
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

export async function updateTicketAction(
  input: UpdateTicketInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = updateTicketSchema.parse(input)

    const before = await prisma.ticket.findUnique({
      where: { id: data.id },
      select: {
        id: true,
        key: true,
        projectId: true,
        title: true,
        description: true,
        remarks: true,
        statusId: true,
        priorityId: true,
        typeId: true,
        assigneeId: true,
        parentId: true,
        dueDate: true,
        startDate: true,
        completedAt: true,
        updatedAt: true,
        estimateHours: true,
        storyPoints: true,
        status: { select: { name: true, category: true } },
        priority: { select: { name: true } },
        type: { select: { name: true } },
        assignee: { select: { name: true } },
      },
    })
    if (!before) throw new NotFoundError('Ticket', data.id)

    const { actor, access } = await requireProjectPermission(before.projectId, 'ticket:update')

    /*
     * Concurrent edit check.
     *
     * Without this the later write simply wins and the earlier author never
     * learns their work was replaced. Comparing the timestamp the client last
     * saw costs one field and turns silent data loss into a message.
     */
    if (
      data.expectedUpdatedAt &&
      before.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()
    ) {
      return fail(
        'Someone else changed this ticket while you were editing. Reload to see their version before saving.',
        { code: 'CONFLICT' },
      )
    }

    // A plain USER may only edit tickets they report or are assigned to, unless
    // their role grants the broader 'ticket:update-any'.
    if (
      !can(actor, 'ticket:update-any') &&
      before.assigneeId !== actor.id &&
      !access.isOwner &&
      access.memberRole !== 'MANAGER'
    ) {
      const isReporter = await prisma.ticket.count({
        where: { id: data.id, reporterId: actor.id },
      })
      if (isReporter === 0) {
        throw new ForbiddenError(
          'You can only edit tickets assigned to you or that you reported.',
        )
      }
    }

    await prisma.$transaction(async (tx) => {
      if (data.parentId !== undefined) {
        await validateParentAssignment(tx, data.id, data.parentId, before.projectId)
      }

      // Resolve the incoming status so completedAt and the audit entry are right.
      let completedAt = before.completedAt
      let newStatusName: string | undefined

      if (data.statusId && data.statusId !== before.statusId) {
        const status = await tx.status.findFirst({
          where: { id: data.statusId, projectId: before.projectId },
          select: { name: true, category: true },
        })
        if (!status) throw new NotFoundError('Status', data.statusId)

        newStatusName = status.name
        completedAt = isTerminal(status.category) ? (before.completedAt ?? new Date()) : null
      }

      await tx.ticket.update({
        where: { id: data.id },
        data: {
          title: data.title,
          description: data.description === undefined ? undefined : data.description || null,
          remarks: data.remarks === undefined ? undefined : data.remarks || null,
          statusId: data.statusId,
          priorityId: data.priorityId,
          typeId: data.typeId,
          assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
          parentId: data.parentId === undefined ? undefined : data.parentId,
          dueDate: data.dueDate === undefined ? undefined : data.dueDate,
          startDate: data.startDate === undefined ? undefined : data.startDate,
          estimateHours: data.estimateHours === undefined ? undefined : data.estimateHours,
          storyPoints: data.storyPoints === undefined ? undefined : data.storyPoints,
          completedAt,
        },
      })

      // --- audit each meaningful change ---------------------------------------
      const base = {
        entityType: 'TICKET' as const,
        entityId: data.id,
        entityLabel: before.key,
        projectId: before.projectId,
        ticketId: data.id,
        actorId: actor.id,
      }

      if (newStatusName) {
        await recordActivity(tx, {
          ...base,
          action: 'STATUS_CHANGED',
          field: 'status',
          oldValue: before.status.name,
          newValue: newStatusName,
          summary: `moved ${before.key} to ${newStatusName}`,
        })
      }

      if (data.priorityId && data.priorityId !== before.priorityId) {
        const priority = await tx.priority.findUnique({
          where: { id: data.priorityId },
          select: { name: true },
        })
        await recordActivity(tx, {
          ...base,
          action: 'PRIORITY_CHANGED',
          field: 'priority',
          oldValue: before.priority.name,
          newValue: priority?.name ?? null,
          summary: `set ${before.key} priority to ${priority?.name ?? 'unknown'}`,
        })
      }

      if (data.assigneeId !== undefined && data.assigneeId !== before.assigneeId) {
        const assignee = data.assigneeId
          ? await tx.user.findUnique({
              where: { id: data.assigneeId },
              select: { name: true },
            })
          : null

        await recordActivity(tx, {
          ...base,
          action: assignee ? 'ASSIGNED' : 'UNASSIGNED',
          field: 'assignee',
          oldValue: before.assignee?.name ?? null,
          newValue: assignee?.name ?? null,
          summary: assignee
            ? `assigned ${before.key} to ${assignee.name}`
            : `unassigned ${before.key}`,
        })

        if (data.assigneeId) {
          await notify(tx, {
            userIds: [data.assigneeId],
            type: 'ASSIGNED',
            actorId: actor.id,
            ticketId: data.id,
            title: `${actor.name} assigned ${before.key} to you`,
            body: before.title,
          })
        }
      }

      if (data.parentId !== undefined && data.parentId !== before.parentId) {
        await recordActivity(tx, {
          ...base,
          action: 'PARENT_CHANGED',
          field: 'parent',
          oldValue: before.parentId,
          newValue: data.parentId,
          summary: data.parentId
            ? `made ${before.key} a child ticket`
            : `detached ${before.key} from its parent`,
        })
      }

      if (data.dueDate !== undefined && data.dueDate?.getTime() !== before.dueDate?.getTime()) {
        await recordActivity(tx, {
          ...base,
          action: 'DUE_DATE_CHANGED',
          field: 'dueDate',
          oldValue: before.dueDate?.toISOString() ?? null,
          newValue: data.dueDate?.toISOString() ?? null,
          summary: data.dueDate
            ? `set ${before.key} due ${data.dueDate.toLocaleDateString()}`
            : `cleared the due date on ${before.key}`,
        })
      }

      if (data.title && data.title !== before.title) {
        await recordActivity(tx, {
          ...base,
          action: 'UPDATED',
          field: 'title',
          oldValue: before.title,
          newValue: data.title,
          summary: `renamed ${before.key}`,
        })
      }

      if (data.labelIds) {
        await syncTicketLabels(tx, {
          ticketId: data.id,
          ticketKey: before.key,
          projectId: before.projectId,
          labelIds: data.labelIds,
          actorId: actor.id,
        })
      }

      // --- roll progress up to the parent(s) ----------------------------------
      if (newStatusName) {
        if (before.parentId) await applyParentRollup(tx, before.parentId, actor.id)
        if (data.parentId && data.parentId !== before.parentId) {
          await applyParentRollup(tx, data.parentId, actor.id)
        }
      }
    })

    revalidateTicket(before.projectId, before.key)
    return ok()
  })
}

/** Kanban drag-and-drop. Rewrites one row thanks to sparse float ordering. */
export async function moveTicketAction(input: MoveTicketInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = moveTicketSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: {
        id: true,
        key: true,
        projectId: true,
        statusId: true,
        parentId: true,
        completedAt: true,
        status: { select: { name: true } },
      },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    await requireProjectPermission(ticket.projectId, 'ticket:transition')
    const actor = await requireActor()

    const status = await prisma.status.findFirst({
      where: { id: data.statusId, projectId: ticket.projectId },
      select: { id: true, name: true, category: true },
    })
    if (!status) throw new NotFoundError('Status', data.statusId)

    const position = calculatePosition(data.beforePosition, data.afterPosition)
    const statusChanged = status.id !== ticket.statusId

    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: data.ticketId },
        data: {
          statusId: status.id,
          position,
          completedAt: isTerminal(status.category)
            ? (ticket.completedAt ?? new Date())
            : null,
        },
      })

      if (statusChanged) {
        await recordActivity(tx, {
          action: 'STATUS_CHANGED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId: ticket.projectId,
          ticketId: ticket.id,
          actorId: actor.id,
          field: 'status',
          oldValue: ticket.status.name,
          newValue: status.name,
          summary: `moved ${ticket.key} to ${status.name}`,
        })

        if (ticket.parentId) {
          await applyParentRollup(tx, ticket.parentId, actor.id)
        }
      }
    })

    revalidateTicket(ticket.projectId, ticket.key)
    return ok()
  })
}

export async function bulkUpdateTicketsAction(
  input: BulkUpdateInput,
): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const data = bulkUpdateSchema.parse(input)
    const actor = await requireActor()

    const tickets = await prisma.ticket.findMany({
      where: { id: { in: data.ticketIds } },
      select: { id: true, key: true, projectId: true, parentId: true },
    })
    if (tickets.length === 0) throw new NotFoundError('Tickets')

    // Every selected ticket must be in a project the actor can write to.
    const projectIds = [...new Set(tickets.map((t) => t.projectId))]
    for (const projectId of projectIds) {
      await requireProjectPermission(projectId, 'ticket:update-any')
    }

    let updated = 0

    await prisma.$transaction(
      async (tx) => {
        for (const ticket of tickets) {
          // Status and priority are project-scoped, so validate per ticket.
          const status = data.statusId
            ? await tx.status.findFirst({
                where: { id: data.statusId, projectId: ticket.projectId },
                select: { id: true, name: true, category: true },
              })
            : null

          const priority = data.priorityId
            ? await tx.priority.findFirst({
                where: { id: data.priorityId, projectId: ticket.projectId },
                select: { id: true, name: true },
              })
            : null

          await tx.ticket.update({
            where: { id: ticket.id },
            data: {
              statusId: status?.id,
              priorityId: priority?.id,
              assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
              completedAt: status
                ? isTerminal(status.category)
                  ? new Date()
                  : null
                : undefined,
            },
          })

          if (data.addLabelIds.length > 0) {
            const valid = await tx.label.findMany({
              where: { id: { in: data.addLabelIds }, projectId: ticket.projectId },
              select: { id: true },
            })
            if (valid.length > 0) {
              await tx.ticketLabel.createMany({
                data: valid.map((l) => ({ ticketId: ticket.id, labelId: l.id })),
                skipDuplicates: true,
              })
            }
          }

          if (data.removeLabelIds.length > 0) {
            await tx.ticketLabel.deleteMany({
              where: { ticketId: ticket.id, labelId: { in: data.removeLabelIds } },
            })
          }

          await recordActivity(tx, {
            action: status ? 'STATUS_CHANGED' : 'UPDATED',
            entityType: 'TICKET',
            entityId: ticket.id,
            entityLabel: ticket.key,
            projectId: ticket.projectId,
            ticketId: ticket.id,
            actorId: actor.id,
            summary: status
              ? `moved ${ticket.key} to ${status.name} (bulk edit)`
              : `updated ${ticket.key} (bulk edit)`,
          })

          if (status && ticket.parentId) {
            await applyParentRollup(tx, ticket.parentId, actor.id)
          }

          updated++
        }
      },
      { timeout: 30_000 },
    )

    for (const projectId of projectIds) revalidateTicket(projectId)
    return ok({ updated })
  })
}

export async function archiveTicketAction(
  input: ArchiveTicketInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = archiveTicketSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, key: true, projectId: true, parentId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update-any')

    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: data.ticketId },
        data: { isArchived: data.isArchived },
      })

      // Archiving a parent archives its children — leaving orphaned children
      // visible on the board would be confusing.
      await tx.ticket.updateMany({
        where: { parentId: data.ticketId },
        data: { isArchived: data.isArchived },
      })

      await recordActivity(tx, {
        action: data.isArchived ? 'ARCHIVED' : 'RESTORED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        summary: `${data.isArchived ? 'archived' : 'restored'} ${ticket.key}`,
      })

      if (ticket.parentId) await applyParentRollup(tx, ticket.parentId, actor.id)
    })

    revalidateTicket(ticket.projectId, ticket.key)
    return ok()
  })
}

export async function deleteTicketAction(
  input: DeleteTicketInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteTicketSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: {
        id: true,
        key: true,
        title: true,
        projectId: true,
        parentId: true,
        _count: { select: { children: true } },
      },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:delete')

    await prisma.$transaction(async (tx) => {
      // Children survive as top-level tickets rather than disappearing silently
      // (the schema's SET NULL does this; stating it explicitly keeps the audit
      // entry honest).
      if (ticket._count.children > 0) {
        await tx.ticket.updateMany({
          where: { parentId: ticket.id },
          data: { parentId: null },
        })
      }

      await tx.ticket.delete({ where: { id: ticket.id } })

      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        actorId: actor.id,
        summary:
          ticket._count.children > 0
            ? `deleted ${ticket.key} — ${ticket._count.children} child tickets were detached`
            : `deleted ${ticket.key} — ${ticket.title}`,
      })

      if (ticket.parentId) await applyParentRollup(tx, ticket.parentId, actor.id)
    })

    revalidateTicket(ticket.projectId)
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Resources
// -----------------------------------------------------------------------------

export async function addResourceAction(
  input: AddResourceInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = addResourceSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, key: true, projectId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')

    const resource = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketResource.create({
        data: {
          ticketId: data.ticketId,
          name: data.name,
          type: data.type,
          url: data.url,
          notes: data.notes || null,
          createdById: actor.id,
        },
        select: { id: true, name: true },
      })

      await recordActivity(tx, {
        action: 'RESOURCE_ADDED',
        entityType: 'RESOURCE',
        entityId: created.id,
        entityLabel: created.name,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        newValue: data.url,
        summary: `linked ${created.name} to ${ticket.key}`,
      })

      return created
    })

    revalidateTicket(ticket.projectId, ticket.key)
    return ok({ id: resource.id })
  })
}

export async function removeResourceAction(
  input: RemoveResourceInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = removeResourceSchema.parse(input)

    const resource = await prisma.ticketResource.findUnique({
      where: { id: data.resourceId },
      select: {
        id: true,
        name: true,
        ticket: { select: { id: true, key: true, projectId: true } },
      },
    })
    if (!resource) throw new NotFoundError('Resource', data.resourceId)

    const { actor } = await requireProjectPermission(resource.ticket.projectId, 'ticket:update')

    await prisma.$transaction(async (tx) => {
      await tx.ticketResource.delete({ where: { id: data.resourceId } })

      await recordActivity(tx, {
        action: 'RESOURCE_REMOVED',
        entityType: 'RESOURCE',
        entityId: resource.id,
        entityLabel: resource.name,
        projectId: resource.ticket.projectId,
        ticketId: resource.ticket.id,
        actorId: actor.id,
        summary: `removed the link ${resource.name} from ${resource.ticket.key}`,
      })
    })

    revalidateTicket(resource.ticket.projectId, resource.ticket.key)
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------

export async function createCommentAction(
  input: CreateCommentInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = createCommentSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, key: true, projectId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'comment:create')

    // Replies may only attach to a comment on the same ticket.
    if (data.parentId) {
      const parent = await prisma.comment.findFirst({
        where: { id: data.parentId, ticketId: data.ticketId },
        select: { id: true },
      })
      if (!parent) {
        throw new BusinessRuleError('The comment you are replying to no longer exists.')
      }
    }

    const comment = await prisma.$transaction(async (tx) => {
      const mentioned = await resolveMentions(tx, data.body)

      const created = await tx.comment.create({
        data: {
          ticketId: data.ticketId,
          authorId: actor.id,
          body: data.body,
          parentId: data.parentId ?? null,
          mentions: mentioned.length
            ? { create: mentioned.map((user) => ({ userId: user.id })) }
            : undefined,
        },
        select: { id: true },
      })

      await recordActivity(tx, {
        action: 'COMMENTED',
        entityType: 'COMMENT',
        entityId: created.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        summary: data.parentId
          ? `replied on ${ticket.key}`
          : `commented on ${ticket.key}`,
      })

      // --- tell the people who should know -------------------------------
      if (mentioned.length > 0) {
        await notify(tx, {
          userIds: mentioned.map((user) => user.id),
          type: 'MENTIONED',
          actorId: actor.id,
          ticketId: ticket.id,
          commentId: created.id,
          title: `${actor.name} mentioned you on ${ticket.key}`,
          body: preview(data.body),
        })
      }

      // The author of the comment being replied to, unless they were already
      // mentioned — one notification per event, not two.
      if (data.parentId) {
        const parent = await tx.comment.findUnique({
          where: { id: data.parentId },
          select: { authorId: true },
        })
        const alreadyMentioned = new Set(mentioned.map((u) => u.id))
        if (parent && !alreadyMentioned.has(parent.authorId)) {
          await notify(tx, {
            userIds: [parent.authorId],
            type: 'COMMENT_REPLY',
            actorId: actor.id,
            ticketId: ticket.id,
            commentId: created.id,
            title: `${actor.name} replied to you on ${ticket.key}`,
            body: preview(data.body),
          })
        }
      }

      /*
       * Everyone following the ticket hears about it.
       *
       * Last, and with the people already told removed, because `notify` only
       * de-duplicates within a single call — without this, a watcher who was
       * also mentioned would get the same comment twice.
       */
      const alreadyTold = new Set<string>([
        ...mentioned.map((user) => user.id),
        ...(data.parentId ? [(await tx.comment.findUnique({
          where: { id: data.parentId },
          select: { authorId: true },
        }))?.authorId ?? ''] : []),
      ])

      const audience = (await ticketAudience(ticket.id)).filter(
        (userId) => !alreadyTold.has(userId),
      )

      if (audience.length > 0) {
        await notify(tx, {
          userIds: audience,
          type: 'COMMENT_REPLY',
          actorId: actor.id,
          ticketId: ticket.id,
          commentId: created.id,
          title: `${actor.name} commented on ${ticket.key}`,
          body: preview(data.body),
        })
      }

      return created
    })

    revalidateTicket(ticket.projectId, ticket.key)
    return ok({ id: comment.id })
  })
}

export async function updateCommentAction(
  input: UpdateCommentInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = updateCommentSchema.parse(input)
    const actor = await requireActor()

    const comment = await prisma.comment.findUnique({
      where: { id: data.commentId },
      select: {
        id: true,
        authorId: true,
        deletedAt: true,
        ticket: { select: { id: true, key: true, projectId: true } },
      },
    })
    if (!comment) throw new NotFoundError('Comment', data.commentId)
    if (comment.deletedAt) throw new BusinessRuleError('That comment has been deleted.')

    // Editing is always restricted to the author — not even an admin rewrites
    // someone else's words.
    if (comment.authorId !== actor.id) {
      throw new ForbiddenError('You can only edit your own comments.')
    }

    await prisma.$transaction(async (tx) => {
      const mentioned = await resolveMentions(tx, data.body)

      await tx.comment.update({
        where: { id: data.commentId },
        data: { body: data.body, isEdited: true, editedAt: new Date() },
      })

      await tx.commentMention.deleteMany({ where: { commentId: data.commentId } })
      if (mentioned.length > 0) {
        await tx.commentMention.createMany({
          data: mentioned.map((user) => ({ commentId: data.commentId, userId: user.id })),
        })
      }

      await recordActivity(tx, {
        action: 'COMMENT_EDITED',
        entityType: 'COMMENT',
        entityId: data.commentId,
        entityLabel: comment.ticket.key,
        projectId: comment.ticket.projectId,
        ticketId: comment.ticket.id,
        actorId: actor.id,
        summary: `edited a comment on ${comment.ticket.key}`,
      })
    })

    revalidateTicket(comment.ticket.projectId, comment.ticket.key)
    return ok()
  })
}

export async function deleteCommentAction(
  input: DeleteCommentInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteCommentSchema.parse(input)
    const actor = await requireActor()

    const comment = await prisma.comment.findUnique({
      where: { id: data.commentId },
      select: {
        id: true,
        authorId: true,
        ticket: { select: { id: true, key: true, projectId: true } },
      },
    })
    if (!comment) throw new NotFoundError('Comment', data.commentId)

    // Authors delete their own; moderators with 'comment:delete-any' may remove
    // anyone's.
    if (comment.authorId !== actor.id) {
      await requireProjectPermission(comment.ticket.projectId, 'comment:delete-any')
    } else {
      await requireProjectPermission(comment.ticket.projectId, 'comment:create')
    }

    await prisma.$transaction(async (tx) => {
      // Soft delete keeps the thread structure intact for any replies.
      await tx.comment.update({
        where: { id: data.commentId },
        data: { deletedAt: new Date(), body: '' },
      })

      await recordActivity(tx, {
        action: 'COMMENT_DELETED',
        entityType: 'COMMENT',
        entityId: data.commentId,
        entityLabel: comment.ticket.key,
        projectId: comment.ticket.projectId,
        ticketId: comment.ticket.id,
        actorId: actor.id,
        summary: `deleted a comment on ${comment.ticket.key}`,
      })
    })

    revalidateTicket(comment.ticket.projectId, comment.ticket.key)
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Read helpers callable from client components
// -----------------------------------------------------------------------------

/**
 * Duplicate suggestions shown while a ticket is being drafted.
 * Deterministic title-overlap scoring — no AI call, no cost, instant.
 */
export async function suggestSimilarTicketsAction(
  projectId: string,
  title: string,
): Promise<ActionResult<Array<{ id: string; key: string; title: string; statusName: string; score: number }>>> {
  return runAction(async () => {
    if (title.trim().length < 5) return ok([])
    await requireProjectPermission(projectId, 'project:view')

    const { findSimilarTickets } = await import('./queries')
    const matches = await findSimilarTickets(projectId, title, 4)
    return ok(matches)
  })
}

// -----------------------------------------------------------------------------
// Links and watchers
// -----------------------------------------------------------------------------

export async function linkTicketsAction(
  input: LinkTicketInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = linkTicketSchema.parse(input)

    const [source, target] = await Promise.all([
      prisma.ticket.findUnique({
        where: { key: data.ticketKey.toUpperCase() },
        select: { id: true, key: true, projectId: true },
      }),
      prisma.ticket.findUnique({
        where: { key: data.targetKey.toUpperCase() },
        select: { id: true, key: true, title: true, projectId: true, assigneeId: true },
      }),
    ])

    if (!source) throw new NotFoundError('Ticket', data.ticketKey)
    if (!target) return fail(`${data.targetKey.toUpperCase()} does not exist.`)

    const { actor } = await requireProjectPermission(source.projectId, 'ticket:update')
    // Linking reveals a ticket's key and title, so the other end has to be
    // visible to this actor as well — otherwise a link is an oracle.
    await requireProjectView(target.projectId)

    const existing = await prisma.ticketLink.findMany({
      where: {
        OR: [
          { sourceId: source.id, targetId: target.id },
          { sourceId: target.id, targetId: source.id },
        ],
      },
      select: { sourceId: true, targetId: true, type: true },
    })

    const verdict = validateLink(source.id, target.id, data.type, existing)
    if (!verdict.ok) return fail(verdict.reason)

    await prisma.$transaction(async (tx) => {
      await tx.ticketLink.create({
        data: {
          sourceId: source.id,
          targetId: target.id,
          type: data.type,
          createdById: actor.id,
        },
      })

      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TICKET',
        entityId: source.id,
        entityLabel: source.key,
        projectId: source.projectId,
        ticketId: source.id,
        actorId: actor.id,
        summary: `${describeLink(data.type, 'outgoing')} ${target.key}`,
      })

      // The person who now has something in their way should be told. This is
      // what the TICKET_BLOCKED notification type was always for.
      if (data.type === 'BLOCKS' && target.assigneeId) {
        await notify(tx, {
          userIds: [target.assigneeId],
          type: 'TICKET_BLOCKED',
          actorId: actor.id,
          ticketId: target.id,
          title: `${target.key} is now blocked by ${source.key}`,
          body: target.title,
        })
      }
    })

    revalidatePath(`/tickets/${source.key}`)
    revalidatePath(`/tickets/${target.key}`)
    return ok(undefined)
  })
}

export async function unlinkTicketsAction(linkId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const link = await prisma.ticketLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        type: true,
        source: { select: { id: true, key: true, projectId: true } },
        target: { select: { key: true } },
      },
    })
    if (!link) return fail('That link no longer exists.')

    const { actor } = await requireProjectPermission(link.source.projectId, 'ticket:update')

    await prisma.$transaction(async (tx) => {
      await tx.ticketLink.delete({ where: { id: link.id } })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TICKET',
        entityId: link.source.id,
        entityLabel: link.source.key,
        projectId: link.source.projectId,
        ticketId: link.source.id,
        actorId: actor.id,
        summary: `removed link to ${link.target.key}`,
      })
    })

    revalidatePath(`/tickets/${link.source.key}`)
    return ok(undefined)
  })
}

/** Follow or unfollow a ticket. Returns the state it ended in. */
export async function toggleWatchAction(
  ticketId: string,
): Promise<ActionResult<{ watching: boolean }>> {
  return runAction(async () => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, key: true, projectId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', ticketId)

    // Watching is reading, not writing: anyone who can see the ticket may follow
    // it. Requiring update permission would stop exactly the people who most
    // need to keep an eye on something.
    const { actor } = await requireProjectView(ticket.projectId)

    const existing = await prisma.ticketWatcher.findUnique({
      where: { ticketId_userId: { ticketId, userId: actor.id } },
      select: { ticketId: true },
    })

    if (existing) {
      await prisma.ticketWatcher.delete({
        where: { ticketId_userId: { ticketId, userId: actor.id } },
      })
    } else {
      await prisma.ticketWatcher.create({ data: { ticketId, userId: actor.id } })
    }

    revalidatePath(`/tickets/${ticket.key}`)
    return ok({ watching: !existing })
  })
}

/**
 * Suggests a type, priority and labels from the project's own history.
 *
 * No model call, so it is free, instant and cannot be rate-limited — and the
 * suggestion is explainable, which is what makes it acceptable to act on.
 */
export async function suggestTriageAction(
  projectId: string,
  title: string,
  description?: string,
): Promise<ActionResult<TriageSuggestion | null>> {
  return runAction(async () => {
    await requireProjectView(projectId)

    if (title.trim().length < 5) return ok(null)

    const suggestion = await suggestTriage(projectId, title, description).catch(() => null)
    return ok(suggestion)
  })
}
