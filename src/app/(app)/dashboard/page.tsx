import type { Metadata } from 'next'

import { requireUser } from '@/features/auth/guards'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const actor = await requireUser()

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${actor.name.split(' ')[0]}`}
        description="Your workspace at a glance."
      />
      <div className="p-4 sm:p-6" />
    </div>
  )
}
