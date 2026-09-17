import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { requireUser } from '@/features/auth/guards'
import { ProfileForm } from '@/features/auth/components/profile-form'
import { PageHeader } from '@/components/shared/page-header'
import { UserAvatar } from '@/components/shared/user-avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ROLE_LABELS } from '@/core/domain/rbac'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const actor = await requireUser()

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      name: true,
      username: true,
      email: true,
      jobTitle: true,
      avatarColor: true,
      createdAt: true,
      lastLoginAt: true,
      role: { select: { key: true } },
    },
  })

  if (!user) redirect('/login')

  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile and account." />

      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Your username and role are managed by an administrator.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <UserAvatar name={user.name} color={user.avatarColor} size="lg" />
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-medium">@{user.username}</p>
                <p className="truncate text-muted-foreground">{user.email}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[user.role.key]}
                  {user.lastLoginAt &&
                    ` · Last signed in ${user.lastLoginAt.toLocaleDateString()}`}
                </p>
              </div>
            </div>

            <ProfileForm
              defaultValues={{ name: user.name, jobTitle: user.jobTitle ?? '' }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
