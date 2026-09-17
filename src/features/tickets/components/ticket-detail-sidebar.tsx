'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { DatePicker } from '@/components/shared/date-picker'
import { UserPicker, type PickableUser } from '@/components/shared/user-picker'
import {
  ConfigSelect,
  LabelMultiSelect,
  PrioritySelect,
  type ConfigOption,
  type PriorityOption,
} from './ticket-form-fields'
import { updateTicketAction } from '../actions'

/**
 * Ticket property sidebar. Every control writes immediately — there is no
 * "save" button, which matches how Linear and Jira behave.
 */
export function TicketDetailSidebar({
  ticketId,
  canEdit,
  statuses,
  priorities,
  types,
  labels,
  members,
  current,
}: {
  ticketId: string
  canEdit: boolean
  statuses: ConfigOption[]
  priorities: PriorityOption[]
  types: ConfigOption[]
  labels: ConfigOption[]
  members: PickableUser[]
  current: {
    statusId: string
    priorityId: string
    typeId: string
    assigneeId: string | null
    labelIds: string[]
    dueDate: Date | null
    startDate: Date | null
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [state, setState] = React.useState(current)

  React.useEffect(() => setState(current), [current])

  function patch(changes: Partial<typeof current>) {
    const previous = state
    setState((value) => ({ ...value, ...changes }))

    startTransition(async () => {
      const result = await updateTicketAction({ id: ticketId, ...changes })
      if (!result.success) {
        setState(previous)
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  const disabled = !canEdit || isPending

  return (
    <aside className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <ConfigSelect
          options={statuses}
          value={state.statusId}
          onChange={(statusId) => patch({ statusId })}
          placeholder="Status"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Assignee</Label>
        <UserPicker
          users={members}
          value={state.assigneeId}
          onChange={(assigneeId) => patch({ assigneeId })}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Priority</Label>
        <PrioritySelect
          options={priorities}
          value={state.priorityId}
          onChange={(priorityId) => patch({ priorityId })}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <ConfigSelect
          options={types}
          value={state.typeId}
          onChange={(typeId) => patch({ typeId })}
          placeholder="Type"
          disabled={disabled}
        />
      </div>

      <Separator />

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Labels</Label>
        <LabelMultiSelect
          options={labels}
          value={state.labelIds}
          onChange={(labelIds) => patch({ labelIds })}
          disabled={disabled}
        />
      </div>

      <Separator />

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Start date</Label>
        <DatePicker
          value={state.startDate}
          onChange={(startDate) => patch({ startDate })}
          disabled={disabled}
          placeholder="Not set"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Due date</Label>
        <DatePicker
          value={state.dueDate}
          onChange={(dueDate) => patch({ dueDate })}
          disabled={disabled}
          placeholder="Not set"
        />
      </div>
    </aside>
  )
}
