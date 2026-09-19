'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requireActor, can } from '@/features/auth/guards'
import { ok, type ActionResult } from '@/core/domain/result'
import { ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { ticketFiltersSchema } from './types'
import { fromCriteria, toCriteria } from './criteria'

const saveFilterSchema = z.object({
  name: z.string().trim().min(1, 'Name this filter set.').max(60),
  projectId: z.string().nullable().optional(),
  isShared: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  viewType: z.enum(['TABLE', 'KANBAN', 'CALENDAR', 'TIMELINE']).default('TABLE'),
  filters: ticketFiltersSchema,
})
export type SaveFilterInput = z.infer<typeof saveFilterSchema>

export async function saveFilterAction(
  input: SaveFilterInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireActor()
    const data = saveFilterSchema.parse(input)

    const saved = await prisma.savedFilter.upsert({
      where: { ownerId_name: { ownerId: actor.id, name: data.name } },
      update: {
        projectId: data.projectId ?? null,
        isShared: data.isShared,
        isPinned: data.isPinned,
        viewType: data.viewType,
        sortBy: data.filters.sortBy,
        sortDir: data.filters.sortDir,
        // Replace criteria wholesale — a saved filter is a snapshot, not a diff.
        criteria: { deleteMany: {}, createMany: { data: toCriteria(data.filters) } },
      },
      create: {
        name: data.name,
        ownerId: actor.id,
        projectId: data.projectId ?? null,
        isShared: data.isShared,
        isPinned: data.isPinned,
        viewType: data.viewType,
        sortBy: data.filters.sortBy,
        sortDir: data.filters.sortDir,
        criteria: { createMany: { data: toCriteria(data.filters) } },
      },
      select: { id: true },
    })

    revalidatePath('/my-tickets')
    revalidatePath('/projects')
    return ok({ id: saved.id })
  })
}

export async function deleteFilterAction(filterId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()

    const filter = await prisma.savedFilter.findUnique({
      where: { id: filterId },
      select: { ownerId: true, projectId: true },
    })
    if (!filter) throw new NotFoundError('Saved filter', filterId)

    // Shared filters are still owned by one person; only they (or an admin) may
    // remove them.
    if (filter.ownerId !== actor.id && !can(actor, 'project:access-all')) {
      throw new ForbiddenError('You can only delete your own saved filters.')
    }

    await prisma.savedFilter.delete({ where: { id: filterId } })

    revalidatePath('/my-tickets')
    if (filter.projectId) revalidatePath(`/projects/${filter.projectId}`)
    return ok()
  })
}

/**
 * Saved filters visible to the actor: their own, plus anything shared.
 *
 * Ownership and project scope are separate AND clauses — collapsing them into
 * one object would let the project condition overwrite the ownership one and
 * expose other people's private filters.
 */
export async function listSavedFilters(projectId?: string) {
  const actor = await requireActor()

  const filters = await prisma.savedFilter.findMany({
    where: {
      AND: [
        { OR: [{ ownerId: actor.id }, { isShared: true }] },
        ...(projectId ? [{ OR: [{ projectId }, { projectId: null }] }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      isShared: true,
      isPinned: true,
      viewType: true,
      projectId: true,
      sortBy: true,
      sortDir: true,
      ownerId: true,
      owner: { select: { name: true } },
      criteria: {
        select: { field: true, operator: true, value: true },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: [{ isPinned: 'desc' }, { name: 'asc' }],
  })

  return filters.map((filter) => ({
    ...filter,
    isOwn: filter.ownerId === actor.id,
    filters: fromCriteria(filter.criteria, filter.sortBy, filter.sortDir),
  }))
}

export type SavedFilterItem = Awaited<ReturnType<typeof listSavedFilters>>[number]
