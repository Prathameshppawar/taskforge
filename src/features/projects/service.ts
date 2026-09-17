import type { Prisma } from '@prisma/client'

import { buildTicketKey } from '@/core/domain/ticket-rules'
import { NotFoundError } from '@/core/domain/errors'
import type { TxClient } from '@/features/activity/service'

/**
 * Project instantiation.
 *
 * A project never invents its own workflow: it always clones one from a
 * template. This keeps "Create from Template" and plain creation on a single
 * code path, and means an admin editing a template changes what new projects
 * inherit.
 */

export interface InstantiateTemplateArgs {
  projectId: string
  projectCode: string
  templateId: string
  includeTickets: boolean
  reporterId: string
  actorId: string
}

export interface InstantiatedConfig {
  initialStatusId: string
  defaultPriorityId: string
  defaultTypeId: string
  ticketsCreated: number
}

export async function instantiateTemplate(
  tx: TxClient,
  args: InstantiateTemplateArgs,
): Promise<InstantiatedConfig> {
  const template = await tx.projectTemplate.findUnique({
    where: { id: args.templateId },
    include: {
      statuses: { orderBy: { position: 'asc' } },
      priorities: { orderBy: { level: 'asc' } },
      types: { orderBy: { position: 'asc' } },
      labels: true,
      tickets: { orderBy: { position: 'asc' }, include: { labelNames: true } },
    },
  })

  if (!template) throw new NotFoundError('Project template', args.templateId)

  // --- clone workflow configuration -----------------------------------------
  await tx.status.createMany({
    data: template.statuses.map((s) => ({
      projectId: args.projectId,
      name: s.name,
      category: s.category,
      color: s.color,
      position: s.position,
      isInitial: s.isInitial,
    })),
  })

  await tx.priority.createMany({
    data: template.priorities.map((p) => ({
      projectId: args.projectId,
      name: p.name,
      color: p.color,
      level: p.level,
      isDefault: p.isDefault,
    })),
  })

  await tx.ticketType.createMany({
    data: template.types.map((t) => ({
      projectId: args.projectId,
      name: t.name,
      color: t.color,
      icon: t.icon,
      position: t.position,
      isDefault: t.isDefault,
    })),
  })

  await tx.label.createMany({
    data: template.labels.map((l) => ({
      projectId: args.projectId,
      name: l.name,
      color: l.color,
      description: l.description,
    })),
  })

  // --- resolve the cloned ids ------------------------------------------------
  const [statuses, priorities, types, labels] = await Promise.all([
    tx.status.findMany({ where: { projectId: args.projectId }, orderBy: { position: 'asc' } }),
    tx.priority.findMany({ where: { projectId: args.projectId }, orderBy: { level: 'asc' } }),
    tx.ticketType.findMany({ where: { projectId: args.projectId }, orderBy: { position: 'asc' } }),
    tx.label.findMany({ where: { projectId: args.projectId } }),
  ])

  const initialStatusId = (statuses.find((s) => s.isInitial) ?? statuses[0])?.id
  const defaultPriorityId = (priorities.find((p) => p.isDefault) ?? priorities[0])?.id
  const defaultTypeId = (types.find((t) => t.isDefault) ?? types[0])?.id

  if (!initialStatusId || !defaultPriorityId || !defaultTypeId) {
    throw new NotFoundError(
      'Template configuration',
      'the template must define at least one status, priority and ticket type',
    )
  }

  const priorityByName = new Map(priorities.map((p) => [p.name, p.id]))
  const typeByName = new Map(types.map((t) => [t.name, t.id]))
  const labelByName = new Map(labels.map((l) => [l.name, l.id]))

  let ticketsCreated = 0

  // --- materialize the default ticket scaffold -------------------------------
  if (args.includeTickets && template.tickets.length > 0) {
    const roots = template.tickets.filter((t) => t.parentId === null)
    let number = 1

    for (const root of roots) {
      const parent = await tx.ticket.create({
        data: {
          projectId: args.projectId,
          number,
          key: buildTicketKey(args.projectCode, number),
          title: root.title,
          description: root.description,
          statusId: initialStatusId,
          priorityId: priorityByName.get(root.priorityName ?? '') ?? defaultPriorityId,
          typeId: typeByName.get(root.typeName ?? '') ?? defaultTypeId,
          reporterId: args.reporterId,
          createdById: args.actorId,
          position: number * 1000,
          labels: {
            create: root.labelNames
              .map((l) => labelByName.get(l.labelName))
              .filter((id): id is string => Boolean(id))
              .map((labelId) => ({ labelId })),
          },
        },
      })
      number++
      ticketsCreated++

      for (const child of template.tickets.filter((t) => t.parentId === root.id)) {
        await tx.ticket.create({
          data: {
            projectId: args.projectId,
            number,
            key: buildTicketKey(args.projectCode, number),
            title: child.title,
            description: child.description,
            statusId: initialStatusId,
            priorityId: priorityByName.get(child.priorityName ?? '') ?? defaultPriorityId,
            typeId: typeByName.get(child.typeName ?? '') ?? defaultTypeId,
            parentId: parent.id,
            reporterId: args.reporterId,
            createdById: args.actorId,
            position: number * 1000,
            labels: {
              create: child.labelNames
                .map((l) => labelByName.get(l.labelName))
                .filter((id): id is string => Boolean(id))
                .map((labelId) => ({ labelId })),
            },
          },
        })
        number++
        ticketsCreated++
      }
    }

    await tx.projectSettings.update({
      where: { projectId: args.projectId },
      data: { nextTicketNumber: number },
    })
  }

  return { initialStatusId, defaultPriorityId, defaultTypeId, ticketsCreated }
}

/**
 * Loads a project's workflow configuration in one round-trip.
 * Used by ticket creation, the board, and the AI tool layer.
 */
export async function loadProjectConfig(tx: TxClient, projectId: string) {
  const [statuses, priorities, types, labels] = await Promise.all([
    tx.status.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
    tx.priority.findMany({ where: { projectId }, orderBy: { level: 'desc' } }),
    tx.ticketType.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
    tx.label.findMany({ where: { projectId }, orderBy: { name: 'asc' } }),
  ])

  return {
    statuses,
    priorities,
    types,
    labels,
    initialStatus: statuses.find((s) => s.isInitial) ?? statuses[0],
    defaultPriority: priorities.find((p) => p.isDefault) ?? priorities[0],
    defaultType: types.find((t) => t.isDefault) ?? types[0],
  }
}

export type ProjectConfig = Awaited<ReturnType<typeof loadProjectConfig>>

/**
 * Allocates the next ticket number for a project.
 *
 * The increment happens inside the caller's transaction, so two concurrent
 * creations cannot be handed the same number — the row is locked by the update.
 */
export async function allocateTicketNumber(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  const settings = await tx.projectSettings.update({
    where: { projectId },
    data: { nextTicketNumber: { increment: 1 } },
    select: { nextTicketNumber: true },
  })

  // The update returns the value AFTER incrementing, so the number just
  // allocated is one less.
  return settings.nextTicketNumber - 1
}
