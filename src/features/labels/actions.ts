'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission, requireProjectView } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import {
  createLabelSchema,
  deleteLabelSchema,
  importLabelsSchema,
  updateLabelSchema,
  type CreateLabelInput,
  type DeleteLabelInput,
  type ImportLabelsInput,
  type UpdateLabelInput,
} from './schemas'

export async function createLabelAction(
  input: CreateLabelInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = createLabelSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'label:create')

    const duplicate = await prisma.label.findUnique({
      where: { projectId_name: { projectId: data.projectId, name: data.name } },
      select: { id: true },
    })
    if (duplicate) {
      return fail(`This project already has a label called "${data.name}".`, {
        code: 'CONFLICT',
        fieldErrors: { name: ['Already exists in this project.'] },
      })
    }

    const label = await prisma.$transaction(async (tx) => {
      const created = await tx.label.create({
        data: {
          projectId: data.projectId,
          name: data.name,
          color: data.color,
          description: data.description || null,
        },
        select: { id: true, name: true },
      })

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'LABEL',
        entityId: created.id,
        entityLabel: created.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `created label ${created.name}`,
      })

      return created
    })

    revalidatePath(`/projects/${data.projectId}/labels`)
    return ok({ id: label.id })
  })
}

export async function updateLabelAction(input: UpdateLabelInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = updateLabelSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'label:update')

    const before = await prisma.label.findFirst({
      where: { id: data.id, projectId: data.projectId },
      select: { name: true, color: true },
    })
    if (!before) throw new NotFoundError('Label', data.id)

    await prisma.$transaction(async (tx) => {
      await tx.label.update({
        where: { id: data.id },
        data: {
          name: data.name,
          color: data.color,
          description: data.description || null,
        },
      })

      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'LABEL',
        entityId: data.id,
        entityLabel: data.name,
        projectId: data.projectId,
        actorId: actor.id,
        field: before.name !== data.name ? 'name' : 'color',
        oldValue: before.name !== data.name ? before.name : before.color,
        newValue: before.name !== data.name ? data.name : data.color,
        summary: `updated label ${data.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/labels`)
    return ok()
  })
}

export async function deleteLabelAction(input: DeleteLabelInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = deleteLabelSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'label:delete')

    const label = await prisma.label.findFirst({
      where: { id: data.id, projectId: data.projectId },
      select: { name: true, _count: { select: { tickets: true } } },
    })
    if (!label) throw new NotFoundError('Label', data.id)

    await prisma.$transaction(async (tx) => {
      // ticket_labels rows cascade, so the label simply detaches from tickets.
      await tx.label.delete({ where: { id: data.id } })

      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'LABEL',
        entityId: data.id,
        entityLabel: label.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary:
          label._count.tickets > 0
            ? `deleted label ${label.name} (removed from ${label._count.tickets} tickets)`
            : `deleted label ${label.name}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/labels`)
    return ok()
  })
}

/**
 * Copies labels from one project into another.
 *
 * Labels are project-scoped by design, so this is a copy rather than a share.
 * Names that already exist in the target are skipped rather than overwritten.
 */
export async function importLabelsAction(
  input: ImportLabelsInput,
): Promise<ActionResult<{ imported: number; skipped: number }>> {
  return runAction(async () => {
    const data = importLabelsSchema.parse(input)
    const { actor } = await requireProjectPermission(data.targetProjectId, 'label:create')

    // The actor must also be able to see the project being copied from.
    await requireProjectView(data.sourceProjectId)

    const sourceLabels = await prisma.label.findMany({
      where: {
        projectId: data.sourceProjectId,
        ...(data.labelIds.length > 0 ? { id: { in: data.labelIds } } : {}),
      },
      select: { name: true, color: true, description: true },
    })

    if (sourceLabels.length === 0) {
      return fail('That project has no labels to import.', { code: 'NOT_FOUND' })
    }

    const existing = await prisma.label.findMany({
      where: { projectId: data.targetProjectId },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((l) => l.name.toLowerCase()))

    const toImport = sourceLabels.filter((l) => !existingNames.has(l.name.toLowerCase()))
    const skipped = sourceLabels.length - toImport.length

    if (toImport.length === 0) {
      return fail('Every label from that project already exists here.', { code: 'CONFLICT' })
    }

    const sourceProject = await prisma.project.findUnique({
      where: { id: data.sourceProjectId },
      select: { name: true },
    })

    await prisma.$transaction(async (tx) => {
      await tx.label.createMany({
        data: toImport.map((label) => ({
          projectId: data.targetProjectId,
          name: label.name,
          color: label.color,
          description: label.description,
        })),
      })

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'LABEL',
        entityId: data.targetProjectId,
        projectId: data.targetProjectId,
        actorId: actor.id,
        summary: `imported ${toImport.length} labels from ${sourceProject?.name ?? 'another project'}`,
      })
    })

    revalidatePath(`/projects/${data.targetProjectId}/labels`)
    return ok({ imported: toImport.length, skipped })
  })
}
