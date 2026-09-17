'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ColorDot, PriorityBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { bulkUpdateTicketsAction } from '../actions'
import type { TicketTableContext } from './ticket-table'

/** Floating toolbar shown while rows are selected in the table. */
export function BulkActionBar({
  ticketIds,
  context,
  onDone,
}: {
  ticketIds: string[]
  context: TicketTableContext
  onDone: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function apply(payload: Parameters<typeof bulkUpdateTicketsAction>[0]) {
    startTransition(async () => {
      const result = await bulkUpdateTicketsAction(payload)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Updated ${result.data.updated} tickets.`)
      onDone()
      router.refresh()
    })
  }

  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur sm:px-6">
      <span className="text-sm font-medium tabular-nums">
        {ticketIds.length} selected
      </span>

      <div className="mx-2 h-5 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8" disabled={isPending}>
            Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {context.statuses.map((status) => (
            <DropdownMenuItem
              key={status.id}
              onSelect={() => apply({ ticketIds, statusId: status.id, addLabelIds: [], removeLabelIds: [] })}
            >
              <ColorDot color={status.color} />
              {status.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8" disabled={isPending}>
            Priority
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {context.priorities.map((priority) => (
            <DropdownMenuItem
              key={priority.id}
              onSelect={() =>
                apply({ ticketIds, priorityId: priority.id, addLabelIds: [], removeLabelIds: [] })
              }
            >
              <PriorityBadge
                name={priority.name}
                color={priority.color}
                level={priority.level}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8" disabled={isPending}>
            Assignee
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem
            onSelect={() =>
              apply({ ticketIds, assigneeId: null, addLabelIds: [], removeLabelIds: [] })
            }
          >
            <span className="size-5 rounded-full border border-dashed" />
            Unassign
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {context.members.map((member) => (
            <DropdownMenuItem
              key={member.id}
              onSelect={() =>
                apply({ ticketIds, assigneeId: member.id, addLabelIds: [], removeLabelIds: [] })
              }
            >
              <UserAvatar name={member.name} color={member.avatarColor} size="xs" />
              {member.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {context.labels.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={isPending}>
              Add label
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {context.labels.map((label) => (
              <DropdownMenuItem
                key={label.id}
                onSelect={() =>
                  apply({ ticketIds, addLabelIds: [label.id], removeLabelIds: [] })
                }
              >
                <ColorDot color={label.color} />
                {label.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-8 gap-1"
        onClick={onDone}
        disabled={isPending}
      >
        <X className="size-3.5" />
        Clear
      </Button>
    </div>
  )
}
