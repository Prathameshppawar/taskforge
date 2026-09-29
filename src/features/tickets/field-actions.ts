'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { displayFieldValue, normaliseFieldValue, parseOptions } from '@/core/domain/custom-fields'
import { runAction } from '@/lib/safe-action'
import { writeFieldValue } from './fields'

/**
 * A project's own ticket fields: defining them (project configuration), and
 * setting a ticket's value (an edit of that ticket, like its priority).
 */

const TYPES = ['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE', 'CHECKBOX', 'URL', 'USER'] as const

const fieldInput = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Name the field.').max(40),
  type: z.enum(TYPES),
  description: z.string().trim().max(200).nullable().optional(),
  options: z.string().max(4000).optional(),
  required: z.boolean().default(false),
})

export async function upsertCustomFieldAction(input: z.input<typeof fieldInput>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = fieldInput.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    const options = data.type === 'SELECT' || data.type === 'MULTI_SELECT' ? parseOptions(data.options ?? '') : []
    if ((data.type === 'SELECT' || data.type === 'MULTI_SELECT') && options.length < 2) {
      return fail('A choice field needs at least two options — one per line.', { fieldErrors: { options: ['Add options.'] } })
    }

    const clash = await prisma.customField.findFirst({
      where: { projectId: data.projectId, name: { equals: data.name, mode: 'insensitive' }, ...(data.id ? { id: { not: data.id } } : {}) },
      select: { id: true },
    })
    if (clash) return fail(`This project already has a field called “${data.name}”.`)

    const field = await prisma.$transaction(async (tx) => {
      let saved: { id: string }
      if (data.id) {
        const existing = await tx.customField.findFirst({ where: { id: data.id, projectId: data.projectId }, select: { type: true } })
        if (!existing) throw new NotFoundError('Field', data.id)
        // Changing the type would reinterpret every stored value; refuse it.
        if (existing.type !== data.type) {
          throw new BusinessRuleError('A field’s type cannot change once it exists. Add a new field instead.')
        }
        saved = await tx.customField.update({
          where: { id: data.id },
          data: { name: data.name, description: data.description || null, options, required: data.required },
          select: { id: true },
        })
      } else {
        const last = await tx.customField.findFirst({ where: { projectId: data.projectId }, orderBy: { position: 'desc' }, select: { position: true } })
        saved = await tx.customField.create({
          data: {
            projectId: data.projectId,
            name: data.name,
            type: data.type,
            description: data.description || null,
            options,
            required: data.required,
            position: (last?.position ?? -1) + 1,
          },
          select: { id: true },
        })
      }
      await recordActivity(tx, {
        action: data.id ? 'UPDATED' : 'CREATED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        projectId: data.projectId,
        actorId: actor.id,
        field: 'customField',
        newValue: data.name,
        summary: `${data.id ? 'updated' : 'added'} the field ${data.name}`,
      })
      return saved
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok({ id: field.id })
  })
}

export async function deleteCustomFieldAction(input: { projectId: string; id: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ projectId: z.string().min(1), id: z.string().min(1) }).parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    const field = await prisma.customField.findFirst({ where: { id: data.id, projectId: data.projectId }, select: { name: true, _count: { select: { values: true } } } })
    if (!field) throw new NotFoundError('Field', data.id)
    await prisma.$transaction(async (tx) => {
      await tx.customField.delete({ where: { id: data.id } })
      // A status that required this field no longer does.
      const statuses = await tx.status.findMany({ where: { projectId: data.projectId, requirements: { has: `FIELD:${data.id}` } }, select: { id: true, requirements: true } })
      for (const status of statuses) {
        await tx.status.update({ where: { id: status.id }, data: { requirements: status.requirements.filter((entry) => entry !== `FIELD:${data.id}`) } })
      }
      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        projectId: data.projectId,
        actorId: actor.id,
        field: 'customField',
        oldValue: field.name,
        summary: `deleted the field ${field.name} and its ${field._count.values} values`,
      })
    })
    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

export async function setFieldValueAction(input: { ticketId: string; fieldId: string; value: unknown }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ ticketId: z.string().min(1), fieldId: z.string().min(1), value: z.unknown() }).parse(input)
    const ticket = await prisma.ticket.findUnique({ where: { id: data.ticketId }, select: { id: true, key: true, projectId: true } })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)
    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')
    const field = await prisma.customField.findFirst({ where: { id: data.fieldId, projectId: ticket.projectId } })
    if (!field) throw new NotFoundError('Field', data.fieldId)

    const normalised = normaliseFieldValue(field, data.value)
    if (!normalised.ok) return fail(normalised.error)

    await prisma.$transaction(async (tx) => {
      const change = await writeFieldValue(tx, { ticketId: ticket.id, projectId: ticket.projectId, field, value: normalised.value })
      if (!change) return
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: actor.id,
        field: field.name,
        oldValue: change.before === null ? null : displayFieldValue(field, change.before),
        newValue: normalised.value === null ? null : displayFieldValue(field, normalised.value),
        summary: normalised.value === null ? `cleared ${field.name} on ${ticket.key}` : `set ${field.name} on ${ticket.key}`,
      })
    })

    revalidatePath(`/tickets/${ticket.key}`)
    return ok()
  })
}
