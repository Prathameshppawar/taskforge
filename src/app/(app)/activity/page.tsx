import type { Metadata } from 'next'

import { requireUser } from '@/features/auth/guards'
import { getWorkspaceActivity } from '@/features/activity/queries'
import { ActivityFeed } from '@/features/activity/components/activity-feed'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Activity' }

export default async function ActivityPage() {
  const actor = await requireUser()
  const items = await getWorkspaceActivity(actor, 150)

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Everything that has happened across the projects you can see."
      />
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border bg-card p-2">
          <ActivityFeed items={items} showTicket />
        </div>
      </div>
    </div>
  )
}
