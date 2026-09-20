import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { requireUser } from '@/features/auth/guards'
import { NotificationPreferences } from '@/features/notifications/components/notification-preferences'
import { PageHeader } from '@/components/shared/page-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const metadata: Metadata = { title: 'Notifications · Settings' }

export default async function NotificationSettingsPage() {
  const actor = await requireUser()

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { notificationSound: true },
  })

  if (!user) redirect('/login')

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="How TaskForge tells you that something needs you."
      />

      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Sound</CardTitle>
            <CardDescription>
              Notifications always appear on the bell. This controls whether they
              are also audible.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationPreferences soundEnabled={user.notificationSound} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
