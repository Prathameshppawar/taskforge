import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { requireUser } from '@/features/auth/guards'
import { roleHas } from '@/core/domain/rbac'
import { CreateProjectForm } from '@/features/projects/components/create-project-form'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'New project' }

export default async function NewProjectPage() {
  const actor = await requireUser()

  if (!roleHas(actor.role, 'project:create')) {
    redirect('/projects')
  }

  const [templates, users] = await Promise.all([
    prisma.projectTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        isDefault: true,
        _count: { select: { statuses: true, labels: true, tickets: true } },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, username: true, avatarColor: true, jobTitle: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div>
      <PageHeader
        title="New project"
        description="Pick a template to start with a ready-made workflow."
      />

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <CreateProjectForm
          currentUserId={actor.id}
          users={users}
          templates={templates.map((template) => ({
            id: template.id,
            name: template.name,
            description: template.description,
            color: template.color,
            isDefault: template.isDefault,
            statusCount: template._count.statuses,
            labelCount: template._count.labels,
            ticketCount: template._count.tickets,
          }))}
        />
      </div>
    </div>
  )
}
