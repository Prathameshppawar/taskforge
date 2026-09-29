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
  cycles = [],
  current,
}: {
  ticketId: string
  canEdit: boolean
  statuses: ConfigOption[]
  priorities: PriorityOption[]
  types: ConfigOption[]
  labels: ConfigOption[]
  members: PickableUser[]
  /** Open sprints and milestones. */
  cycles?: Array<{ id: string; name: string; state: string }>
  current: {
    statusId: string
    priorityId: string
    typeId: string
    assigneeId: string | null
    labelIds: string[]
    dueDate: Date | null
    startDate: Date | null
    cycleId?: string | null
    storyPoints?: number | null
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

      {(cycles.length > 0 || state.cycleId) && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Sprint or milestone</Label>
          <ConfigSelect
            options={[
              { id: '', name: 'Backlog', color: 'slate' },
              ...cycles.map((cycle) => ({
                id: cycle.id,
                name: cycle.state === 'ACTIVE' ? `${cycle.name} (running)` : cycle.name,
                color: cycle.state === 'ACTIVE' ? 'emerald' : 'sky',
              })),
            ]}
            value={state.cycleId ?? ''}
            onChange={(cycleId) => patch({ cycleId: cycleId || null })}
            placeholder="Backlog"
            disabled={disabled}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="story-points" className="text-xs text-muted-foreground">Story points</Label>
        <PointsInput
          value={state.storyPoints ?? null}
          disabled={disabled}
          onCommit={(storyPoints) => patch({ storyPoints })}
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

/** Commits on blur or Enter, so typing "13" is one change, not two. */
function PointsInput({
  value,
  disabled,
  onCommit,
}: {
  value: number | null
  disabled: boolean
  onCommit: (value: number | null) => void
}) {
  const [draft, setDraft] = React.useState(value === null ? '' : String(value))
  React.useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const commit = () => {
    const next = draft.trim() === '' ? null : Math.max(0, Math.min(999, Math.round(Number(draft))))
    if (next !== null && Number.isNaN(next)) return setDraft(value === null ? '' : String(value))
    if (next !== value) onCommit(next)
  }
  return (
    <input
      id="story-points"
      type="number"
      min={0}
      max={999}
      inputMode="numeric"
      placeholder="Not pointed"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && (event.currentTarget as HTMLInputElement).blur()}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
    />
  )
}
