import { formatDistanceToNow } from 'date-fns'
import type { ActivityAction } from '@prisma/client'
import {
  Activity,
  ArrowRight,
  CircleCheck,
  CirclePlus,
  Flag,
  Link2,
  MessageSquare,
  Pencil,
  Tag,
  Trash2,
  UserPlus,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/shared/user-avatar'
import { EmptyState } from '@/components/shared/page-header'

export interface ActivityItem {
  id: string
  action: ActivityAction
  entityLabel: string | null
  field: string | null
  oldValue: string | null
  newValue: string | null
  summary: string | null
  createdAt: Date
  actor: { id: string; name: string; avatarColor: string } | null
  ticket?: { key: string; title: string } | null
}

const ICONS: Partial<Record<ActivityAction, React.ComponentType<{ className?: string }>>> = {
  CREATED: CirclePlus,
  UPDATED: Pencil,
  DELETED: Trash2,
  STATUS_CHANGED: ArrowRight,
  PRIORITY_CHANGED: Flag,
  ASSIGNED: UserPlus,
  UNASSIGNED: UserPlus,
  COMMENTED: MessageSquare,
  COMMENT_EDITED: MessageSquare,
  COMMENT_DELETED: MessageSquare,
  LABEL_ADDED: Tag,
  LABEL_REMOVED: Tag,
  MEMBER_ADDED: UserPlus,
  MEMBER_REMOVED: UserPlus,
  RESOURCE_ADDED: Link2,
  RESOURCE_REMOVED: Link2,
  ARCHIVED: CircleCheck,
  RESTORED: CircleCheck,
}

/**
 * Unified audit timeline.
 *
 * Entries render from the `summary` captured at write time rather than being
 * reconstructed here — that is what keeps history readable after a ticket is
 * renamed or a user is removed.
 */
export function ActivityFeed({
  items,
  showTicket = false,
  emptyMessage = 'Nothing has happened here yet.',
}: {
  items: ActivityItem[]
  showTicket?: boolean
  emptyMessage?: string
}) {
  if (items.length === 0) {
    return <EmptyState icon={Activity} title="No activity" description={emptyMessage} />
  }

  return (
    <ol className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.action] ?? Activity

        return (
          <li key={item.id} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-accent/40">
            <span className="relative flex shrink-0 flex-col items-center">
              {item.actor ? (
                <UserAvatar
                  name={item.actor.name}
                  color={item.actor.avatarColor}
                  size="sm"
                />
              ) : (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                  <Icon className="size-3 text-muted-foreground" />
                </span>
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">
                <span className="font-medium">{item.actor?.name ?? 'System'}</span>{' '}
                <span className="text-muted-foreground">
                  {item.summary ?? describeFallback(item)}
                </span>
              </p>

              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{formatDistanceToNow(item.createdAt, { addSuffix: true })}</span>

                {showTicket && item.ticket && (
                  <span className="font-mono">{item.ticket.key}</span>
                )}

                {item.field && item.oldValue && item.newValue && (
                  <span className="inline-flex items-center gap-1">
                    <span className="rounded bg-muted px-1 line-through">{item.oldValue}</span>
                    <ArrowRight className="size-3" />
                    <span className={cn('rounded bg-muted px-1 font-medium')}>
                      {item.newValue}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Only used for legacy rows written without a summary. */
function describeFallback(item: ActivityItem): string {
  const target = item.entityLabel ?? 'an item'
  switch (item.action) {
    case 'CREATED':
      return `created ${target}`
    case 'DELETED':
      return `deleted ${target}`
    case 'STATUS_CHANGED':
      return `changed the status of ${target}`
    case 'ASSIGNED':
      return `assigned ${target}`
    default:
      return `updated ${target}`
  }
}
