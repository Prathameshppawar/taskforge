'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requireActor, requirePermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { assertCanActOnUser } from '@/features/roles/service'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { assertCanAppointManagers, assertCanManageTeam } from './service'

const teamSchema = z.object({
  name: z.string().trim().min(2, 'Name this team.').max(60),
  description: z.string().trim().max(200).nullable().optional(),
})

const createTeamSchema = teamSchema
const updateTeamSchema = teamSchema.extend({ id: z.string().min(1) })

const memberSchema = z.object({
  teamId: z.string().min(1),
  userId: z.string().min(1),
  isManager: z.boolean().optional(),
})

export type CreateTeamInput = z.infer<typeof createTeamSchema>
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>
export type TeamMemberInput = z.infer<typeof memberSchema>

export async function createTeamAction(
  input: CreateTeamInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermission('team:manage')
    const data = createTeamSchema.parse(input)

    const existing = await prisma.team.findUnique({
      where: { name: data.name },
      select: { id: true },
    })
    if (existing) {
      return fail('A team with that name already exists.', {
        code: 'CONFLICT',
        fieldErrors: { name: ['Already in use.'] },
      })
    }

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          createdById: actor.id,
        },
        select: { id: true },
      })

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'TEAM',
        entityId: created.id,
        entityLabel: data.name,
        actorId: actor.id,
        summary: `Created team "${data.name}"`,
      })

      return created
    })

    revalidatePath('/admin/teams')
    return ok({ id: team.id })
  })
}

export async function updateTeamAction(input: UpdateTeamInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('team:manage')
    const data = updateTeamSchema.parse(input)

    await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: data.id },
        data: { name: data.name, description: data.description ?? null },
      })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'TEAM',
        entityId: data.id,
        entityLabel: data.name,
        actorId: actor.id,
        summary: `Renamed team to "${data.name}"`,
      })
    })

    revalidatePath('/admin/teams')
    return ok(undefined)
  })
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('team:manage')

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    })
    if (!team) return fail('That team no longer exists.', { code: 'NOT_FOUND' })

    await prisma.$transaction(async (tx) => {
      // Memberships cascade; the team is a grouping, not the people in it.
      await tx.team.delete({ where: { id: team.id } })
      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'TEAM',
        entityId: team.id,
        entityLabel: team.name,
        actorId: actor.id,
        summary: `Deleted team "${team.name}"`,
      })
    })

    revalidatePath('/admin/teams')
    return ok(undefined)
  })
}

export async function setTeamMemberAction(
  input: TeamMemberInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    const data = memberSchema.parse(input)

    const scope = await assertCanManageTeam(actor, data.teamId)
    if (data.isManager) assertCanAppointManagers(scope)

    // Seniority still applies inside a team you manage.
    await assertCanActOnUser(actor, data.userId)

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { name: true },
    })
    if (!user) return fail('That person no longer exists.', { code: 'NOT_FOUND' })

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: data.teamId, userId: data.userId } },
        update: { isManager: data.isManager ?? false },
        create: {
          teamId: data.teamId,
          userId: data.userId,
          isManager: data.isManager ?? false,
        },
      })

      await recordActivity(tx, {
        action: 'MEMBER_ADDED',
        entityType: 'TEAM',
        entityId: data.teamId,
        entityLabel: scope.name,
        actorId: actor.id,
        summary: `${user.name} is now ${data.isManager ? 'a manager' : 'a member'} of ${scope.name}`,
      })
    })

    revalidatePath('/admin/teams')
    return ok(undefined)
  })
}

export async function removeTeamMemberAction(
  input: Pick<TeamMemberInput, 'teamId' | 'userId'>,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    const data = memberSchema.pick({ teamId: true, userId: true }).parse(input)

    const scope = await assertCanManageTeam(actor, data.teamId)
    await assertCanActOnUser(actor, data.userId)

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { name: true },
    })

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({
        where: { teamId: data.teamId, userId: data.userId },
      })
      await recordActivity(tx, {
        action: 'MEMBER_REMOVED',
        entityType: 'TEAM',
        entityId: data.teamId,
        entityLabel: scope.name,
        actorId: actor.id,
        summary: `${user?.name ?? 'Someone'} was removed from ${scope.name}`,
      })
    })

    revalidatePath('/admin/teams')
    return ok(undefined)
  })
}
