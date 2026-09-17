'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, CircleDashed } from 'lucide-react'

import { cn, isOverdue } from '@/lib/utils'
import { isTerminal } from '@/core/domain/ticket-rules'
import { Progress } from '@/components/ui/progress'
import { LabelChip, PriorityBadge, StatusBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { EmptyState } from '@/components/shared/page-header'

interface TreeChild {
  id: string
  key: string
  title: string
  dueDate: Date | null
  status: { id: string; name: string; color: string; category: string }
  priority: { name: string; color: string; level: number }
  type: { name: string; color: string }
  assignee: { id: string; name: string; avatarColor: string } | null
  labels: Array<{ label: { id: string; name: string; color: string } }>
}

interface TreeNode extends TreeChild {
  children: TreeChild[]
  progress: { completionPercent: number; total: number; completed: number }
}

/**
 * Hierarchy view: parent features with their implementation tasks and a rollup
 * bar showing how far each feature has got.
 */
export function TicketTree({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={CircleDashed}
          title="No tickets yet"
          description="Create a parent ticket to represent a feature, then break it into child tasks."
        />
      </div>
    )
  }

  return (
    <div className="space-y-2 p-4 sm:p-6">
      {nodes.map((node) => (
        <TreeRow key={node.id} node={node} />
      ))}
    </div>
  )
}

function TreeRow({ node }: { node: TreeNode }) {
  const [open, setOpen] = React.useState(true)
  const hasChildren = node.children.length > 0

  return (
    <div className="rounded-xl border bg-card">
      {/* Parent */}
      <div className="flex flex-wrap items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={!hasChildren}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded transition-colors',
            hasChildren ? 'hover:bg-accent' : 'opacity-0',
          )}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>

        <Link
          href={`/tickets/${node.key}`}
          className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {node.key}
        </Link>

        <Link href={`/tickets/${node.key}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
          {node.title}
        </Link>

        {hasChildren && (
          <div className="flex w-40 shrink-0 items-center gap-2">
            <Progress value={node.progress.completionPercent} className="h-1.5" />
            <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
              {node.progress.completed}/{node.progress.total} · {node.progress.completionPercent}%
            </span>
          </div>
        )}

        <StatusBadge name={node.status.name} color={node.status.color} />
        <PriorityBadge
          name={node.priority.name}
          color={node.priority.color}
          level={node.priority.level}
          showLabel={false}
        />
        {node.assignee ? (
          <UserAvatar name={node.assignee.name} color={node.assignee.avatarColor} size="sm" />
        ) : (
          <span className="size-6 rounded-full border border-dashed" title="Unassigned" />
        )}
      </div>

      {/* Children */}
      {open && hasChildren && (
        <ul className="border-t">
          {node.children.map((child) => {
            const overdue = isOverdue(child.dueDate, isTerminal(child.status.category as never))
            return (
              <li
                key={child.id}
                className="flex flex-wrap items-center gap-3 border-b px-3 py-2 pl-11 last:border-b-0 hover:bg-accent/30"
              >
                <Link
                  href={`/tickets/${child.key}`}
                  className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  {child.key}
                </Link>

                <Link
                  href={`/tickets/${child.key}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {child.title}
                </Link>

                {child.labels.slice(0, 2).map(({ label }) => (
                  <LabelChip key={label.id} name={label.name} color={label.color} />
                ))}

                {child.dueDate && (
                  <span
                    className={cn(
                      'shrink-0 text-[11px]',
                      overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {child.dueDate.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                )}

                <StatusBadge name={child.status.name} color={child.status.color} />
                <PriorityBadge
                  name={child.priority.name}
                  color={child.priority.color}
                  level={child.priority.level}
                  showLabel={false}
                />
                {child.assignee ? (
                  <UserAvatar
                    name={child.assignee.name}
                    color={child.assignee.avatarColor}
                    size="xs"
                  />
                ) : (
                  <span className="size-5 rounded-full border border-dashed" title="Unassigned" />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
