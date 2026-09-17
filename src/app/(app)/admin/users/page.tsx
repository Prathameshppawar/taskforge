import type { Metadata } from 'next'

import { prisma } from '@/infrastructure/db/prisma'
import { requireAdminPage } from '@/features/auth/guards'
import { UserManager } from '@/features/admin/components/user-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Users' }

export default async function AdminUsersPage() {
  const actor = await requireAdminPage()

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      jobTitle: true,
      avatarColor: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      role: { select: { key: true } },
      _count: { select: { memberships: true, assignedTickets: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })

  return (
    <div>
      <PageHeader
        title="Users"
        description="Accounts are provisioned here — there is no self sign-up."
      />

      <div className="p-4 sm:p-6">
        <UserManager
          currentUserId={actor.id}
          users={users.map((user) => ({
            id: user.id,
            username: user.username,
            email: user.email,
            name: user.name,
            jobTitle: user.jobTitle,
            avatarColor: user.avatarColor,
            isActive: user.isActive,
            mustChangePassword: user.mustChangePassword,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt,
            role: user.role.key,
            projectCount: user._count.memberships,
            assignedCount: user._count.assignedTickets,
          }))}
        />
      </div>
    </div>
  )
}
