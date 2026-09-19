import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser, can } from '@/features/auth/guards'
import { manageableTeamIds } from '@/features/teams/service'
import { TeamManager } from '@/features/teams/components/team-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Teams' }

export default async function AdminTeamsPage() {
  const actor = await getCurrentUser()
  if (!actor) redirect('/login')

  const canManageAll = can(actor, 'team:manage')
  const scope = await manageableTeamIds(actor)

  // A delegated manager has no business seeing teams they do not run, so the
  // page shows only what they can act on rather than a list of locked rows.
  if (scope !== 'all' && scope.length === 0) redirect('/forbidden?reason=permission')

  const teams = await prisma.team.findMany({
    where: scope === 'all' ? {} : { id: { in: scope } },
    select: {
      id: true,
      name: true,
      description: true,
      members: {
        select: {
          isManager: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              avatarColor: true,
              role: { select: { name: true } },
            },
          },
        },
        orderBy: [{ isManager: 'desc' }, { user: { name: 'asc' } }],
      },
    },
    orderBy: { name: 'asc' },
  })

  // Only people this actor outranks can be added — the same rule the action
  // enforces, applied here so the picker never offers an impossible choice.
  const assignablePeople = await prisma.user.findMany({
    where: { isActive: true, role: { level: { gt: actor.level } } },
    select: { id: true, name: true, username: true, avatarColor: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Groups of people, and who is trusted to administer them."
      />

      <div className="p-4 sm:p-6">
        <TeamManager
          canCreateTeams={canManageAll}
          assignablePeople={assignablePeople}
          teams={teams.map((team) => ({
            id: team.id,
            name: team.name,
            description: team.description,
            canEditTeam: canManageAll,
            canManageMembers: true,
            members: team.members.map((member) => ({
              id: member.user.id,
              name: member.user.name,
              username: member.user.username,
              avatarColor: member.user.avatarColor,
              roleName: member.user.role.name,
              isManager: member.isManager,
            })),
          }))}
        />
      </div>
    </div>
  )
}
