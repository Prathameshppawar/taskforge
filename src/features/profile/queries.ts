import { prisma } from '@/infrastructure/db/prisma'
import type { DirectoryEntry } from '@/components/shared/people-directory'
import { roleRimColor } from './role-colors'

/** Every account's photo version and role rim, for the app layout's directory. */
export async function getPeopleDirectory(): Promise<Array<[string, DirectoryEntry]>> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      avatarUpdatedAt: true,
      role: { select: { key: true, name: true, color: true } },
    },
  })

  return users.map((user) => {
    const ring = roleRimColor(user.role)
    return [
      user.id,
      {
        roleName: user.role.name,
        ...(user.avatarUpdatedAt ? { photo: user.avatarUpdatedAt.getTime() } : {}),
        ...(ring ? { ring } : {}),
      },
    ]
  })
}
