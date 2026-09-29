'use client'

import Link from 'next/link'
import { CalendarClock, GitBranch, Hourglass, ListChecks, MessageSquare, Link2, TimerOff, Timer } from 'lucide-react'

import { cn, isOverdue } from '@/lib/utils'
import { LabelChip, PriorityBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { isTerminal } from '@/core/domain/ticket-rules'
import { stuckDays } from '@/core/domain/flow'
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
  stuckAfterDays = null,
}: {
  ticket: TicketListItem
  isDragging?: boolean
  className?: string
  /** The project's threshold; null turns the flag off. */
  stuckAfterDays?: number | null
}) {
  const overdue = isOverdue(ticket.dueDate, isTerminal(ticket.status.category))
  const stuck = stuckDays(ticket.status.category, new Date(ticket.statusChangedAt), stuckAfterDays, new Date())
  const breached = ticket.slaAlerts.some((alert) => alert.kind.endsWith(':breach'))
  const atRisk = !breached && ticket.slaAlerts.length > 0 && !ticket.completedAt

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

      {(stuck !== null || (breached && !ticket.completedAt) || atRisk) && (
        <div className="flex flex-wrap gap-1">
          {breached && !ticket.completedAt && (
            <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              <TimerOff className="size-3" aria-hidden /> SLA breached
            </span>
          )}
          {atRisk && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              <Timer className="size-3" aria-hidden /> SLA at risk
            </span>
          )}
          {stuck !== null && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              title={`In ${ticket.status.name} for ${stuck} days`}
            >
              <Hourglass className="size-3" aria-hidden /> stuck {stuck}d
            </span>
          )}
        </div>
      )}

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
        {ticket.checklist.length > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1 tabular-nums',
              ticket.checklist.every((item) => item.isDone) && 'text-emerald-600 dark:text-emerald-400',
            )}
            title="Acceptance criteria met"
          >
            <ListChecks className="size-3" />
            {ticket.checklist.filter((item) => item.isDone).length}/{ticket.checklist.length}
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
              userId={ticket.assignee.id}
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
