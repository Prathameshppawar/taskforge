'use client'

import Link from 'next/link'
import { CalendarClock, GitBranch, MessageSquare, Link2 } from 'lucide-react'

import { cn, isOverdue } from '@/lib/utils'
import { LabelChip, PriorityBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { isTerminal } from '@/core/domain/ticket-rules'
import type { TicketListItem } from '../queries'

/**
 * Board card.
 *
 * Deliberately not a <Link> wrapper — dnd-kit binds drag listeners to the card,
 * and nesting a link inside a draggable makes every drag attempt navigate. The
 * ticket key is the only click target instead.
 */
export function TicketCard({
  ticket,
  isDragging,
  className,
}: {
  ticket: TicketListItem
  isDragging?: boolean
  className?: string
}) {
  const overdue = isOverdue(ticket.dueDate, isTerminal(ticket.status.category))

  return (
    <div
      className={cn(
        'group space-y-2 rounded-lg border bg-card p-2.5 shadow-xs transition-shadow',
        'hover:shadow-md',
        isDragging && 'rotate-1 opacity-90 shadow-lg',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/tickets/${ticket.key}`}
          onPointerDown={(event) => event.stopPropagation()}
          className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
        >
          {ticket.key}
        </Link>
        <PriorityBadge
          name={ticket.priority.name}
          color={ticket.priority.color}
          level={ticket.priority.level}
          showLabel={false}
        />
      </div>

      <p className="line-clamp-3 text-sm leading-snug font-medium">{ticket.title}</p>

      {ticket.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ticket.labels.slice(0, 3).map(({ label }) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
          {ticket.labels.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{ticket.labels.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
        {ticket.parent && (
          <span className="inline-flex items-center gap-1" title={`Child of ${ticket.parent.key}`}>
            <GitBranch className="size-3" />
            {ticket.parent.key}
          </span>
        )}
        {ticket._count.children > 0 && (
          <span className="inline-flex items-center gap-1" title="Child tickets">
            <GitBranch className="size-3" />
            {ticket._count.children}
          </span>
        )}
        {ticket._count.comments > 0 && (
          <span className="inline-flex items-center gap-1" title="Comments">
            <MessageSquare className="size-3" />
            {ticket._count.comments}
          </span>
        )}
        {ticket._count.resources > 0 && (
          <span className="inline-flex items-center gap-1" title="Linked resources">
            <Link2 className="size-3" />
            {ticket._count.resources}
          </span>
        )}

        {ticket.dueDate && (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              overdue && 'font-medium text-destructive',
            )}
            title={overdue ? 'Overdue' : 'Due date'}
          >
            <CalendarClock className="size-3" />
            {ticket.dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}

        <span className="ml-auto">
          {ticket.assignee ? (
            <UserAvatar
              name={ticket.assignee.name}
              color={ticket.assignee.avatarColor}
              size="xs"
            />
          ) : (
            <span className="block size-5 rounded-full border border-dashed" title="Unassigned" />
          )}
        </span>
      </div>
    </div>
  )
}
