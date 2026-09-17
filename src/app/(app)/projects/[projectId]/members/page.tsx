import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { getProjectDetail } from '@/features/projects/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { MemberManager } from '@/features/projects/components/member-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Members' }

export default async function MembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const context = await getProjectViewContext(projectId)

  const [project, users] = await Promise.all([
    getProjectDetail(projectId),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, username: true, avatarColor: true, jobTitle: true },
      orderBy: { name: 'asc' },
    }),
  ])

  if (!project) notFound()

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Members"
        description={`${project.members.length} ${
          project.members.length === 1 ? 'person has' : 'people have'
        } access to this project.`}
      />

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
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
      </div>
    </div>
  )
}
