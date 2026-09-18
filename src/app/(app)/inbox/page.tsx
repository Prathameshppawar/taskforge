import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { AtSign, Bell, MessageSquare, UserPlus } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { getNotifications } from '@/features/notifications/queries'
import { PageHeader, EmptyState } from '@/components/shared/page-header'
import { UserAvatar } from '@/components/shared/user-avatar'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Inbox' }

const ICONS = {
  MENTIONED: AtSign,
  ASSIGNED: UserPlus,
  COMMENT_REPLY: MessageSquare,
  TICKET_BLOCKED: Bell,
} as const

export default async function InboxPage() {
  const actor = await requireUser()
  const items = await getNotifications(actor, 100)
  const unread = items.filter((i) => !i.readAt).length

  return (
    <div>
      <PageHeader
        title="Inbox"
        description={
          unread > 0 ? `${unread} unread` : 'Everything you have been notified about.'
        }
      />

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="You will be notified when someone mentions you in a comment, replies to you, or assigns you a ticket."
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {items.map((item) => {
              const Icon = ICONS[item.type] ?? Bell
              return (
                <li key={item.id}>
                  <Link
                    href={item.ticket ? `/tickets/${item.ticket.key}` : '/inbox'}
                    className={cn(
                      'flex gap-3 p-3 transition-colors hover:bg-accent/50',
                      !item.readAt && 'bg-primary/5',
                    )}
                  >
                    {item.actor ? (
                      <UserAvatar
                        name={item.actor.name}
                        color={item.actor.avatarColor}
                        size="md"
                        className="mt-0.5 shrink-0"
                      />
                    ) : (
                      <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{item.title}</p>
                      {item.body && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {item.body}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                        {item.ticket && ` · ${item.ticket.key}`}
                      </p>
                    </div>

                    {!item.readAt && (
                      <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
