import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { getProjectDetail } from '@/features/projects/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { MemberManager } from '@/features/projects/components/member-manager'
import { ProjectTeamManager } from '@/features/projects/components/project-team-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Members' }

export default async function MembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)

  const [project, users, allTeams] = await Promise.all([
    getProjectDetail(projectId),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, username: true, avatarColor: true, jobTitle: true },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      select: { id: true, name: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  if (!project) notFound()

  const attachedIds = new Set(project.teams.map((entry) => entry.team.id))
  const attachable = allTeams.filter((team) => !attachedIds.has(team.id))

  // Access can arrive twice — directly and through a team — so the headline
  // counts distinct people rather than adding two lists together.
  const reach = new Set<string>([
    ...project.members.map((member) => member.user.id),
    ...project.teams.flatMap((entry) => entry.team.members.map((m) => m.user.id)),
  ]).size

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Members"
        description={`${reach} ${reach === 1 ? 'person has' : 'people have'} access — ${
          project.teams.length
        } ${project.teams.length === 1 ? 'team' : 'teams'} and ${project.members.length} ${
          project.members.length === 1 ? 'individual' : 'individuals'
        }.`}
      />

      <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
        <ProjectTeamManager
          projectId={projectId}
          canManage={context.can.manageMembers}
          attachable={attachable.map((team) => ({
            id: team.id,
            name: team.name,
            memberCount: team._count.members,
          }))}
          teams={project.teams.map((entry) => ({
            id: entry.team.id,
            name: entry.team.name,
            description: entry.team.description,
            role: entry.role,
            members: entry.team.members.map((member) => ({
              id: member.user.id,
              name: member.user.name,
              username: member.user.username,
              avatarColor: member.user.avatarColor,
              isManager: member.isManager,
            })),
          }))}
        />

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Individual members</h2>
            <p className="text-xs text-muted-foreground">
              For people who need access to this project but not through a team.
            </p>
          </div>

          <MemberManager
          projectId={projectId}
          canManage={context.can.manageMembers}
          assignableUsers={users}
          members={project.members.map((member) => ({
            userId: member.user.id,
            name: member.user.name,
            username: member.user.username,
            avatarColor: member.user.avatarColor,
            jobTitle: member.user.jobTitle,
            isActive: member.user.isActive,
            role: member.role,
            joinedAt: member.joinedAt,
            isOwner: member.user.id === project.owner.id,
          }))}
          />
        </section>
      </div>
    </div>
  )
}
