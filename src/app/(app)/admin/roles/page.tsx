import type { Metadata } from 'next'

import { prisma } from '@/infrastructure/db/prisma'
import { requirePermissionPage } from '@/features/auth/guards'
import { RoleManager } from '@/features/roles/components/role-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Roles' }

export default async function AdminRolesPage() {
  const actor = await requirePermissionPage('role:manage')

  const roles = await prisma.role.findMany({
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      level: true,
      isSystem: true,
      permissions: { select: { permission: true } },
      _count: { select: { users: true } },
    },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
  })

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Roles"
        description="What each role may do, and how they rank against one another."
      />

      <div className="p-4 sm:p-6">
        <RoleManager
          actorLevel={actor.level}
          actorPermissions={actor.permissions}
          roles={roles.map((role) => ({
            id: role.id,
            key: role.key,
            name: role.name,
            description: role.description,
            level: role.level,
            isSystem: role.isSystem,
            permissions: role.permissions.map((row) => row.permission),
            userCount: role._count.users,
          }))}
        />
      </div>
    </div>
  )
}
