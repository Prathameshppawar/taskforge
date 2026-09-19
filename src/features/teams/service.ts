import { prisma } from '@/infrastructure/db/prisma'
import type { Actor } from '@/features/auth/guards'
import { hasPermission } from '@/core/domain/rbac'
import { ForbiddenError, NotFoundError } from '@/core/domain/errors'

/**
 * Team-scoped delegation.
 *
 * `team:manage` is the workspace-wide grant: create teams, rename them, appoint
 * their managers. `team:manage-members` is the delegated one, and deliberately
 * narrower — it lets someone administer the people inside a team they manage,
 * and nobody else. That is what makes it safe to hand to a team lead.
 *
 * The seniority ceiling still applies on top: managing a team never lets you act
 * on somebody who outranks you, even if they are in it.
 */

export interface TeamScope {
  id: string
  name: string
  /** True when the actor holds the workspace-wide grant rather than a delegated one. */
  global: boolean
}

/** Teams whose membership this actor may change. */
export async function manageableTeamIds(actor: Actor): Promise<'all' | string[]> {
  if (hasPermission(actor.permissions, 'team:manage')) return 'all'

  if (!hasPermission(actor.permissions, 'team:manage-members')) return []

  const rows = await prisma.teamMember.findMany({
    where: { userId: actor.id, isManager: true },
    select: { teamId: true },
  })
  return rows.map((row) => row.teamId)
}

/** Asserts the actor may change who is in this team. */
export async function assertCanManageTeam(actor: Actor, teamId: string): Promise<TeamScope> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true },
  })
  if (!team) throw new NotFoundError('Team', teamId)

  if (hasPermission(actor.permissions, 'team:manage')) {
    return { id: team.id, name: team.name, global: true }
  }

  if (!hasPermission(actor.permissions, 'team:manage-members')) {
    throw new ForbiddenError('You cannot manage teams.')
  }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: actor.id } },
    select: { isManager: true },
  })

  if (!membership?.isManager) {
    throw new ForbiddenError(`You do not manage ${team.name}.`)
  }

  return { id: team.id, name: team.name, global: false }
}

/**
 * Appointing a manager is an escalation in miniature — it hands someone
 * authority over other people — so only the workspace-wide grant may do it. A
 * delegated manager who could appoint co-managers would be able to widen their
 * own circle indefinitely.
 */
export function assertCanAppointManagers(scope: TeamScope) {
  if (!scope.global) {
    throw new ForbiddenError(
      `Only someone with workspace-wide team management can appoint managers for ${scope.name}.`,
    )
  }
}
