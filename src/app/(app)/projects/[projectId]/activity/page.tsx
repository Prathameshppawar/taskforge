import type { Metadata } from 'next'

import { requireProjectView } from '@/features/auth/guards'
import { getProjectActivity } from '@/features/activity/queries'
import { ActivityFeed } from '@/features/activity/components/activity-feed'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Activity' }

export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  await requireProjectView(projectId)

  const items = await getProjectActivity(projectId, 150)

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Activity" description="Audit trail for this project." />
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border bg-card p-2">
          <ActivityFeed items={items} showTicket />
        </div>
      </div>
    </div>
  )
}
