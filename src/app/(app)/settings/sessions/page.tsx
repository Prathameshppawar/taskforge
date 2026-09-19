import type { Metadata } from 'next'
import { formatDistanceToNow } from 'date-fns'
import { MonitorSmartphone } from 'lucide-react'

import { requirePermissionPage } from '@/features/auth/guards'
import { listSessionsAction } from '@/features/auth/actions'
import { SessionTable } from '@/features/admin/components/session-table'
import { PageHeader, EmptyState } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Sessions' }

export default async function SessionsPage() {
  await requirePermissionPage('user:view')
  const sessions = await listSessionsAction()
  const active = sessions.filter((s) => !s.revokedAt)

  return (
    <div>
      <PageHeader
        title="Sessions"
        description={`${active.length} active of ${sessions.length} recorded sign-ins.`}
      />
      <div className="p-4 sm:p-6">
        {sessions.length === 0 ? (
          <EmptyState
            icon={MonitorSmartphone}
            title="No sign-ins recorded"
            description="Sessions appear here as people sign in."
          />
        ) : (
          <SessionTable
            sessions={sessions.map((s) => ({
              id: s.id,
              ipAddress: s.ipAddress,
              userAgent: s.userAgent,
              createdAt: s.createdAt,
              lastSeenAt: s.lastSeenAt,
              revokedAt: s.revokedAt,
              userId: s.user.id,
              name: s.user.name,
              username: s.user.username,
              avatarColor: s.user.avatarColor,
              isActive: s.user.isActive,
              age: formatDistanceToNow(s.createdAt, { addSuffix: true }),
            }))}
          />
        )}
      </div>
    </div>
  )
}
