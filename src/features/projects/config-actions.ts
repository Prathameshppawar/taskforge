'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import {
  deleteConfigSchema,
  prioritySchema,
  reorderSchema,
  statusSchema,
  ticketTypeSchema,
  type DeleteConfigInput,
  type PriorityInput,
  type ReorderInput,
  type StatusInput,
  type TicketTypeInput,
} from './schemas'

/**
 * Project workflow configuration.
 *
 * Statuses, priorities and ticket types are project-scoped and fully editable.
 * Deletion always requires a replacement, because tickets hold a required
 * foreign key to each — the schema's onDelete: Restrict makes an orphaning
 * delete impossible by construction, and this is the supported migration path.
 */

// -----------------------------------------------------------------------------
// Statuses
// -----------------------------------------------------------------------------

export async function upsertStatusAction(input: StatusInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = statusSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const duplicate = await prisma.status.findFirst({
      where: {
        projectId: data.projectId,
        name: data.name,
        ...(data.id ? { id: { not: data.id } } : {}),
      },
      select: { id: true },
    })
    if (duplicate) {
      return fail(`This project already has a status called "${data.name}".`, {
        fieldErrors: { name: ['Already exists.'] },
      })
    }

    await prisma.$transaction(async (tx) => {
      // Only one status can be the initial one.
      if (data.isInitial) {
        await tx.status.updateMany({
          where: { projectId: data.projectId },
          data: { isInitial: false },
        })
      }

      if (data.id) {
        await tx.status.update({
          where: { id: data.id },
          data: {
            name: data.name,
            category: data.category,
            color: data.color,
            isInitial: data.isInitial,
          },
        })
      } else {
        const last = await tx.status.findFirst({
          where: { projectId: data.projectId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })

        await tx.status.create({
          data: {
            projectId: data.projectId,
            name: data.name,
            category: data.category,
            color: data.color,
            isInitial: data.isInitial,
            position: (last?.position ?? -1) + 1,
          },
        })
      }

      await recordActivity(tx, {
        action: data.id ? 'UPDATED' : 'CREATED',
        entityType: 'STATUS',
        entityId: data.id ?? data.name,
        entityLabel: data.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `${data.id ? 'updated' : 'added'} the status ${data.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

export async function reorderStatusesAction(input: ReorderInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = reorderSchema.parse(input)
    await requireProjectPermission(data.projectId, 'project:manage-config')

    await prisma.$transaction(async (tx) => {
      /*
       * position carries a composite unique constraint with projectId, so
       * writing final values directly would collide mid-update. Shifting every
       * row into a temporary high range first keeps each write unique.
       */
      for (const [index, id] of data.orderedIds.entries()) {
        await tx.status.update({
          where: { id },
          data: { position: 10_000 + index },
        })
      }

      for (const [index, id] of data.orderedIds.entries()) {
        await tx.status.update({ where: { id }, data: { position: index } })
      }
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

export async function deleteStatusAction(input: DeleteConfigInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteConfigSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const [status, replacement, total] = await Promise.all([
      prisma.status.findFirst({
        where: { id: data.id, projectId: data.projectId },
        select: { name: true, isInitial: true },
      }),
      prisma.status.findFirst({
        where: { id: data.replacementId, projectId: data.projectId },
        select: { id: true, name: true },
      }),
      prisma.status.count({ where: { projectId: data.projectId } }),
    ])

    if (!status) throw new NotFoundError('Status', data.id)
    if (!replacement) throw new NotFoundError('Replacement status', data.replacementId)
    if (total <= 1) throw new BusinessRuleError('A project needs at least one status.')
    if (data.id === data.replacementId) {
      throw new BusinessRuleError('Choose a different status to move the tickets to.')
    }

    await prisma.$transaction(async (tx) => {
      const moved = await tx.ticket.updateMany({
        where: { statusId: data.id },
        data: { statusId: replacement.id },
      })

      await tx.recurringTicket.updateMany({
        where: { statusId: data.id },
        data: { statusId: replacement.id },
      })

      await tx.status.delete({ where: { id: data.id } })

      // The project must always have exactly one initial status.
      if (status.isInitial) {
        await tx.status.update({
          where: { id: replacement.id },
          data: { isInitial: true },
        })
      }

      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'STATUS',
        entityId: data.id,
        entityLabel: status.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `deleted the status ${status.name}, moving ${moved.count} tickets to ${replacement.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Priorities
// -----------------------------------------------------------------------------

export async function upsertPriorityAction(input: PriorityInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = prioritySchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const clash = await prisma.priority.findFirst({
      where: {
        projectId: data.projectId,
        OR: [{ name: data.name }, { level: data.level }],
        ...(data.id ? { id: { not: data.id } } : {}),
      },
      select: { name: true, level: true },
    })

    if (clash) {
      return clash.name === data.name
        ? fail(`This project already has a priority called "${data.name}".`, {
            fieldErrors: { name: ['Already exists.'] },
          })
        : fail(`Level ${data.level} is already used by "${clash.name}".`, {
            fieldErrors: { level: ['Already used.'] },
          })
    }

    await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.priority.updateMany({
          where: { projectId: data.projectId },
          data: { isDefault: false },
        })
      }

      if (data.id) {
        await tx.priority.update({
          where: { id: data.id },
          data: {
            name: data.name,
            color: data.color,
            level: data.level,
            isDefault: data.isDefault,
          },
        })
      } else {
        await tx.priority.create({
          data: {
            projectId: data.projectId,
            name: data.name,
            color: data.color,
            level: data.level,
            isDefault: data.isDefault,
          },
        })
      }

      await recordActivity(tx, {
        action: data.id ? 'UPDATED' : 'CREATED',
        entityType: 'PRIORITY',
        entityId: data.id ?? data.name,
        entityLabel: data.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `${data.id ? 'updated' : 'added'} the priority ${data.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

export async function deletePriorityAction(
  input: DeleteConfigInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteConfigSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const [priority, replacement, total] = await Promise.all([
      prisma.priority.findFirst({
        where: { id: data.id, projectId: data.projectId },
        select: { name: true, isDefault: true },
      }),
      prisma.priority.findFirst({
        where: { id: data.replacementId, projectId: data.projectId },
        select: { id: true, name: true },
      }),
      prisma.priority.count({ where: { projectId: data.projectId } }),
    ])

    if (!priority) throw new NotFoundError('Priority', data.id)
    if (!replacement) throw new NotFoundError('Replacement priority', data.replacementId)
    if (total <= 1) throw new BusinessRuleError('A project needs at least one priority.')

    await prisma.$transaction(async (tx) => {
      const moved = await tx.ticket.updateMany({
        where: { priorityId: data.id },
        data: { priorityId: replacement.id },
      })
      await tx.recurringTicket.updateMany({
        where: { priorityId: data.id },
        data: { priorityId: replacement.id },
      })

      await tx.priority.delete({ where: { id: data.id } })

      if (priority.isDefault) {
        await tx.priority.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        })
      }

      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'PRIORITY',
        entityId: data.id,
        entityLabel: priority.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `deleted the priority ${priority.name}, moving ${moved.count} tickets to ${replacement.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Ticket types
// -----------------------------------------------------------------------------

export async function upsertTicketTypeAction(
  input: TicketTypeInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = ticketTypeSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const duplicate = await prisma.ticketType.findFirst({
      where: {
        projectId: data.projectId,
        name: data.name,
        ...(data.id ? { id: { not: data.id } } : {}),
      },
      select: { id: true },
    })
    if (duplicate) {
      return fail(`This project already has a type called "${data.name}".`, {
        fieldErrors: { name: ['Already exists.'] },
      })
    }

    await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.ticketType.updateMany({
          where: { projectId: data.projectId },
          data: { isDefault: false },
        })
      }

      if (data.id) {
        await tx.ticketType.update({
          where: { id: data.id },
          data: {
            name: data.name,
            color: data.color,
            icon: data.icon,
            isDefault: data.isDefault,
          },
        })
      } else {
        const last = await tx.ticketType.findFirst({
          where: { projectId: data.projectId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })

        await tx.ticketType.create({
          data: {
            projectId: data.projectId,
            name: data.name,
            color: data.color,
            icon: data.icon,
            isDefault: data.isDefault,
            position: (last?.position ?? -1) + 1,
          },
        })
      }

      await recordActivity(tx, {
        action: data.id ? 'UPDATED' : 'CREATED',
        entityType: 'TICKET_TYPE',
        entityId: data.id ?? data.name,
        entityLabel: data.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `${data.id ? 'updated' : 'added'} the ticket type ${data.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

export async function deleteTicketTypeAction(
  input: DeleteConfigInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteConfigSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const [type, replacement, total] = await Promise.all([
      prisma.ticketType.findFirst({
        where: { id: data.id, projectId: data.projectId },
        select: { name: true, isDefault: true },
      }),
      prisma.ticketType.findFirst({
        where: { id: data.replacementId, projectId: data.projectId },
        select: { id: true, name: true },
      }),
      prisma.ticketType.count({ where: { projectId: data.projectId } }),
    ])

    if (!type) throw new NotFoundError('Ticket type', data.id)
    if (!replacement) throw new NotFoundError('Replacement type', data.replacementId)
    if (total <= 1) throw new BusinessRuleError('A project needs at least one ticket type.')

    await prisma.$transaction(async (tx) => {
      const moved = await tx.ticket.updateMany({
        where: { typeId: data.id },
        data: { typeId: replacement.id },
      })
      await tx.recurringTicket.updateMany({
        where: { typeId: data.id },
        data: { typeId: replacement.id },
      })

      await tx.ticketType.delete({ where: { id: data.id } })

      if (type.isDefault) {
        await tx.ticketType.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        })
      }

      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'TICKET_TYPE',
        entityId: data.id,
        entityLabel: type.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `deleted the ticket type ${type.name}, moving ${moved.count} tickets to ${replacement.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}
