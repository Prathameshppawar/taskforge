'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import {
  requireActor,
  requirePermission,
  requireProjectPermission,
} from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { instantiateTemplate } from './service'
import {
  addMemberSchema,
  projectTeamSchema,
  type ProjectTeamInput,
  archiveProjectSchema,
  createProjectSchema,
  projectSettingsSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
  updateProjectSchema,
  type AddMemberInput,
  type ArchiveProjectInput,
  type CreateProjectInput,
  type ProjectSettingsInput,
  type RemoveMemberInput,
  type UpdateMemberRoleInput,
  type UpdateProjectInput,
} from './schemas'

export async function createProjectAction(
  input: CreateProjectInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const actor = await requirePermission('project:create')
    const data = createProjectSchema.parse(input)

    const existing = await prisma.project.findUnique({
      where: { code: data.code },
      select: { id: true },
    })
    if (existing) {
      return fail(`Project code "${data.code}" is already in use.`, {
        code: 'CONFLICT',
        fieldErrors: { code: ['Already in use.'] },
      })
    }

    const project = await prisma.$transaction(
      async (tx) => {
        const created = await tx.project.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description || null,
            status: data.status,
            startDate: data.startDate ?? null,
            endDate: data.endDate ?? null,
            ownerId: data.ownerId,
            templateId: data.templateId,
            createdById: actor.id,
            settings: { create: { color: data.color } },
          },
          select: { id: true, code: true, name: true },
        })

        // The owner is always a manager; requested members are added alongside.
        const memberIds = new Set(data.memberIds)
        memberIds.delete(data.ownerId)

        await tx.projectMember.create({
          data: {
            projectId: created.id,
            userId: data.ownerId,
            role: 'MANAGER',
            addedById: actor.id,
          },
        })

        if (memberIds.size > 0) {
          await tx.projectMember.createMany({
            data: [...memberIds].map((userId) => ({
              projectId: created.id,
              userId,
              role: 'MEMBER' as const,
              addedById: actor.id,
            })),
          })
        }

        const config = await instantiateTemplate(tx, {
          projectId: created.id,
          projectCode: created.code,
          templateId: data.templateId,
          includeTickets: data.includeTemplateTickets,
          reporterId: data.ownerId,
          actorId: actor.id,
        })

        await recordActivity(tx, {
          action: 'CREATED',
          entityType: 'PROJECT',
          entityId: created.id,
          entityLabel: created.name,
          projectId: created.id,
          actorId: actor.id,
          summary:
            config.ticketsCreated > 0
              ? `created project ${created.name} with ${config.ticketsCreated} tickets from a template`
              : `created project ${created.name}`,
        })

        return created
      },
      // Template instantiation writes a lot of rows; the default 5s can be tight
      // on a cold serverless connection.
      { timeout: 30_000 },
    )

    revalidatePath('/projects')
    revalidatePath('/dashboard')
    return ok({ id: project.id, code: project.code })
  })
}

export async function updateProjectAction(
  input: UpdateProjectInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = updateProjectSchema.parse(input)
    const { actor } = await requireProjectPermission(data.id, 'project:update')

    const before = await prisma.project.findUnique({
      where: { id: data.id },
      select: {
        name: true,
        description: true,
        status: true,
        startDate: true,
        endDate: true,
        ownerId: true,
      },
    })
    if (!before) throw new NotFoundError('Project', data.id)

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: data.id },
        data: {
          name: data.name,
          description: data.description || null,
          status: data.status,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          ownerId: data.ownerId,
        },
      })

      // A new owner must also be a member, with manager rights.
      if (before.ownerId !== data.ownerId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: data.id, userId: data.ownerId } },
          update: { role: 'MANAGER' },
          create: {
            projectId: data.id,
            userId: data.ownerId,
            role: 'MANAGER',
            addedById: actor.id,
          },
        })
      }

      if (before.status !== data.status) {
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'PROJECT',
          entityId: data.id,
          entityLabel: data.name,
          projectId: data.id,
          actorId: actor.id,
          field: 'status',
          oldValue: before.status,
          newValue: data.status,
          summary: `set project status to ${data.status}`,
        })
      } else {
        await recordActivity(tx, {
          action: 'UPDATED',
          entityType: 'PROJECT',
          entityId: data.id,
          entityLabel: data.name,
          projectId: data.id,
          actorId: actor.id,
          summary: `updated project details`,
        })
      }
    })

    revalidatePath(`/projects/${data.id}`)
    revalidatePath('/projects')
    return ok()
  })
}

export async function archiveProjectAction(
  input: ArchiveProjectInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = archiveProjectSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:archive')

    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { name: true },
    })
    if (!project) throw new NotFoundError('Project', data.projectId)

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: data.projectId },
        data: {
          isArchived: data.isArchived,
          archivedAt: data.isArchived ? new Date() : null,
          status: data.isArchived ? 'ARCHIVED' : 'ACTIVE',
        },
      })

      await recordActivity(tx, {
        action: data.isArchived ? 'ARCHIVED' : 'RESTORED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        entityLabel: project.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `${data.isArchived ? 'archived' : 'restored'} project ${project.name}`,
      })
    })

    revalidatePath('/projects')
    revalidatePath(`/projects/${data.projectId}`)
    return ok()
  })
}

export async function updateProjectSettingsAction(
  input: ProjectSettingsInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = projectSettingsSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    await prisma.$transaction(async (tx) => {
      await tx.projectSettings.update({
        where: { projectId: data.projectId },
        data: {
          color: data.color,
          icon: data.icon,
          logoUrl: data.logoUrl || null,
          autoStatusRollup: data.autoStatusRollup,
          allowSubtasks: data.allowSubtasks,
          requireDueDate: data.requireDueDate,
          isPrivate: data.isPrivate,
          defaultAssigneeId: data.defaultAssigneeId || null,
        },
      })

      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        projectId: data.projectId,
        actorId: actor.id,
        summary: 'updated project settings',
      })
    })

    revalidatePath(`/projects/${data.projectId}`)
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Members
// -----------------------------------------------------------------------------

export async function addMembersAction(input: AddMemberInput): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = addMemberSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-members')

    const users = await prisma.user.findMany({
      where: { id: { in: data.userIds }, isActive: true },
      select: { id: true, name: true },
    })
    if (users.length === 0) {
      throw new BusinessRuleError('None of the selected people are active users.')
    }

    const existing = await prisma.projectMember.findMany({
      where: { projectId: data.projectId, userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    })
    const existingIds = new Set(existing.map((m) => m.userId))
    const toAdd = users.filter((u) => !existingIds.has(u.id))

    if (toAdd.length === 0) {
      return fail('Everyone selected is already a member of this project.', {
        code: 'CONFLICT',
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectMember.createMany({
        data: toAdd.map((user) => ({
          projectId: data.projectId,
          userId: user.id,
          role: data.role,
          addedById: actor.id,
        })),
      })

      for (const user of toAdd) {
        await recordActivity(tx, {
          action: 'MEMBER_ADDED',
          entityType: 'MEMBER',
          entityId: user.id,
          entityLabel: user.name,
          projectId: data.projectId,
          actorId: actor.id,
          newValue: data.role,
          summary: `added ${user.name} as ${data.role.toLowerCase()}`,
        })
      }
    })

    revalidatePath(`/projects/${data.projectId}/members`)
    return ok(toAdd.length)
  })
}

export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = updateMemberRoleSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-members')

    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { ownerId: true },
    })
    if (!project) throw new NotFoundError('Project', data.projectId)

    if (project.ownerId === data.userId && data.role !== 'MANAGER') {
      throw new BusinessRuleError(
        'The project owner must remain a manager. Transfer ownership first.',
      )
    }

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: data.projectId, userId: data.userId } },
      select: { role: true, user: { select: { name: true } } },
    })
    if (!member) throw new NotFoundError('Project member')

    await prisma.$transaction(async (tx) => {
      await tx.projectMember.update({
        where: { projectId_userId: { projectId: data.projectId, userId: data.userId } },
        data: { role: data.role },
      })

      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'MEMBER',
        entityId: data.userId,
        entityLabel: member.user.name,
        projectId: data.projectId,
        actorId: actor.id,
        field: 'role',
        oldValue: member.role,
        newValue: data.role,
        summary: `changed ${member.user.name}'s project role to ${data.role.toLowerCase()}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/members`)
    return ok()
  })
}

export async function removeMemberAction(
  input: RemoveMemberInput,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = removeMemberSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-members')

    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { ownerId: true },
    })
    if (!project) throw new NotFoundError('Project', data.projectId)

    if (project.ownerId === data.userId) {
      throw new BusinessRuleError(
        'The project owner cannot be removed. Transfer ownership to someone else first.',
      )
    }

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: data.projectId, userId: data.userId } },
      select: { user: { select: { name: true } } },
    })
    if (!member) throw new NotFoundError('Project member')

    await prisma.$transaction(async (tx) => {
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId: data.projectId, userId: data.userId } },
      })

      // Their tickets stay in the project but become unassigned, so nothing is
      // silently orphaned to a person who can no longer see it.
      await tx.ticket.updateMany({
        where: { projectId: data.projectId, assigneeId: data.userId },
        data: { assigneeId: null },
      })

      await recordActivity(tx, {
        action: 'MEMBER_REMOVED',
        entityType: 'MEMBER',
        entityId: data.userId,
        entityLabel: member.user.name,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `removed ${member.user.name} from the project`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/members`)
    return ok()
  })
}

/** Directory of active users for member pickers. */
/**
 * Attaching a team is the intended way to staff a project: everyone in it gains
 * the role, and a later change to the team reaches every project it is on at
 * once. Individual members remain possible for genuine exceptions.
 */
export async function attachTeamAction(input: ProjectTeamInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = projectTeamSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-members')

    const team = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: { id: true, name: true, _count: { select: { members: true } } },
    })
    if (!team) throw new NotFoundError('Team', data.teamId)

    await prisma.$transaction(async (tx) => {
      await tx.projectTeam.upsert({
        where: { projectId_teamId: { projectId: data.projectId, teamId: data.teamId } },
        update: { role: data.role },
        create: {
          projectId: data.projectId,
          teamId: data.teamId,
          role: data.role,
          addedById: actor.id,
        },
      })

      await recordActivity(tx, {
        action: 'MEMBER_ADDED',
        entityType: 'TEAM',
        entityId: team.id,
        entityLabel: team.name,
        projectId: data.projectId,
        actorId: actor.id,
        newValue: data.role,
        summary: `attached team ${team.name} (${team._count.members} ${
          team._count.members === 1 ? 'person' : 'people'
        }) as ${data.role.toLowerCase()}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/members`)
    return ok(undefined)
  })
}

export async function detachTeamAction(
  input: Pick<ProjectTeamInput, 'projectId' | 'teamId'>,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = projectTeamSchema
      .pick({ projectId: true, teamId: true })
      .parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-members')

    const team = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: { name: true },
    })

    await prisma.$transaction(async (tx) => {
      await tx.projectTeam.deleteMany({
        where: { projectId: data.projectId, teamId: data.teamId },
      })

      await recordActivity(tx, {
        action: 'MEMBER_REMOVED',
        entityType: 'TEAM',
        entityId: data.teamId,
        entityLabel: team?.name ?? 'Team',
        projectId: data.projectId,
        actorId: actor.id,
        summary: `detached team ${team?.name ?? ''}`.trim(),
      })
    })

    revalidatePath(`/projects/${data.projectId}/members`)
    return ok(undefined)
  })
}

export async function searchAssignableUsers(query: string) {
  await requireActor()

  return prisma.user.findMany({
    where: {
      isActive: true,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { username: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, username: true, avatarColor: true, jobTitle: true },
    orderBy: { name: 'asc' },
    take: 25,
  })
}
