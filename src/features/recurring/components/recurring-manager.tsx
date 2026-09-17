'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { RecurrenceFrequency } from '@prisma/client'
import { CalendarClock, Loader2, Pause, Play, Plus, Repeat, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { FREQUENCY_LABELS, WEEKDAY_LABELS, previewSchedule } from '@/core/domain/recurrence'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DatePicker } from '@/components/shared/date-picker'
import { UserPicker, type PickableUser } from '@/components/shared/user-picker'
import {
  ConfigSelect,
  LabelMultiSelect,
  PrioritySelect,
  type ConfigOption,
  type PriorityOption,
} from '@/features/tickets/components/ticket-form-fields'
import { EmptyState } from '@/components/shared/page-header'
import {
  deleteRecurringAction,
  runRecurringNowAction,
  toggleRecurringAction,
  upsertRecurringAction,
} from '../actions'

export interface RecurringRow {
  id: string
  name: string
  title: string
  description: string | null
  frequency: RecurrenceFrequency
  interval: number
  dayOfWeek: number | null
  dayOfMonth: number | null
  dueInDays: number | null
  startDate: Date
  endDate: Date | null
  nextRunAt: Date
  lastRunAt: Date | null
  runCount: number
  isActive: boolean
  statusId: string
  priorityId: string
  typeId: string
  assigneeId: string | null
  labelIds: string[]
  assigneeName: string | null
  generatedCount: number
}

export interface RecurringConfig {
  projectId: string
  statuses: ConfigOption[]
  priorities: PriorityOption[]
  types: ConfigOption[]
  labels: ConfigOption[]
  members: PickableUser[]
}

export function RecurringManager({
  schedules,
  config,
  canManage,
}: {
  schedules: RecurringRow[]
  config: RecurringConfig
  canManage: boolean
}) {
  const [editing, setEditing] = React.useState<RecurringRow | null>(null)
  const [creating, setCreating] = React.useState(false)

  return (
    <div className="space-y-4">
      {canManage && (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New schedule
        </Button>
      )}

      {schedules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring tickets"
          description="Set up a schedule for work that happens on a rhythm — weekly backup validation, a monthly access review, quarterly audits."
        />
      ) : (
        <ul className="space-y-2">
          {schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              canManage={canManage}
              onEdit={() => setEditing(schedule)}
            />
          ))}
        </ul>
      )}

      <ScheduleDialog
        config={config}
        schedule={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
    </div>
  )
}

function ScheduleRow({
  schedule,
  canManage,
  onEdit,
}: {
  schedule: RecurringRow
  canManage: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function toggle() {
    startTransition(async () => {
      const result = await toggleRecurringAction({
        id: schedule.id,
        isActive: !schedule.isActive,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(schedule.isActive ? 'Schedule paused.' : 'Schedule resumed.')
      router.refresh()
    })
  }

  function runNow() {
    startTransition(async () => {
      const result = await runRecurringNowAction(schedule.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.data.ticketKey
          ? `Created ${result.data.ticketKey}.`
          : 'Nothing was generated — the schedule may have ended.',
      )
      router.refresh()
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteRecurringAction({ id: schedule.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Schedule deleted. Tickets it already created are kept.')
      router.refresh()
    })
  }

  const cadence = describeCadence(schedule)

  return (
    <li
      className={cn(
        'rounded-xl border bg-card p-3',
        !schedule.isActive && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Repeat className="size-4 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{schedule.name}</span>
            {!schedule.isActive && <Badge variant="secondary">Paused</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">{schedule.title}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" />
              {cadence}
            </span>
            {schedule.isActive && (
              <span>Next: {schedule.nextRunAt.toLocaleDateString()}</span>
            )}
            <span>{schedule.generatedCount} created</span>
            {schedule.assigneeName && <span>→ {schedule.assigneeName}</span>}
            {schedule.endDate && <span>Ends {schedule.endDate.toLocaleDateString()}</span>}
          </div>
        </div>

        {canManage && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={runNow}
              disabled={isPending || !schedule.isActive}
              title="Generate a ticket now"
              aria-label="Run now"
            >
              <Zap className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggle}
              disabled={isPending}
              aria-label={schedule.isActive ? 'Pause' : 'Resume'}
            >
              {schedule.isActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={onEdit} disabled={isPending}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 hover:text-destructive"
              onClick={remove}
              disabled={isPending}
              aria-label="Delete schedule"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

function describeCadence(schedule: RecurringRow): string {
  const base = FREQUENCY_LABELS[schedule.frequency]
  const every = schedule.interval > 1 ? ` (every ${schedule.interval})` : ''

  if (
    (schedule.frequency === 'WEEKLY' || schedule.frequency === 'BIWEEKLY') &&
    schedule.dayOfWeek != null
  ) {
    return `${base} on ${WEEKDAY_LABELS[schedule.dayOfWeek]}${every}`
  }

  if (schedule.dayOfMonth != null) {
    return `${base} on day ${schedule.dayOfMonth}${every}`
  }

  return `${base}${every}`
}

function ScheduleDialog({
  config,
  schedule,
  open,
  onOpenChange,
}: {
  config: RecurringConfig
  schedule: RecurringRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const [form, setForm] = React.useState(() => blankForm(config))

  React.useEffect(() => {
    if (!open) return
    setForm(schedule ? fromSchedule(schedule) : blankForm(config))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule])

  // Live preview of the next few runs, computed from the same pure function the
  // server uses — so what the user sees is what will actually happen.
  const preview = React.useMemo(() => {
    try {
      return previewSchedule(
        {
          frequency: form.frequency,
          interval: form.interval,
          dayOfWeek: form.dayOfWeek,
          dayOfMonth: form.dayOfMonth,
          startDate: form.startDate,
          endDate: form.endDate,
        },
        4,
      )
    } catch {
      return []
    }
  }, [form.frequency, form.interval, form.dayOfWeek, form.dayOfMonth, form.startDate, form.endDate])

  function submit() {
    startTransition(async () => {
      const result = await upsertRecurringAction({
        id: schedule?.id,
        projectId: config.projectId,
        name: form.name,
        title: form.title,
        description: form.description,
        statusId: form.statusId,
        priorityId: form.priorityId,
        typeId: form.typeId,
        assigneeId: form.assigneeId,
        labelIds: form.labelIds,
        frequency: form.frequency,
        interval: form.interval,
        dayOfWeek: form.dayOfWeek,
        dayOfMonth: form.dayOfMonth,
        dueInDays: form.dueInDays,
        startDate: form.startDate,
        endDate: form.endDate,
        isActive: form.isActive,
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(schedule ? 'Schedule updated.' : 'Schedule created.')
      onOpenChange(false)
      router.refresh()
    })
  }

  const needsWeekday = form.frequency === 'WEEKLY' || form.frequency === 'BIWEEKLY'
  const needsMonthDay =
    form.frequency === 'MONTHLY' || form.frequency === 'QUARTERLY' || form.frequency === 'YEARLY'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{schedule ? 'Edit schedule' : 'New recurring ticket'}</DialogTitle>
          <DialogDescription>
            A ticket is generated automatically on each occurrence.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62dvh]">
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="sched-name">Schedule name</Label>
              <Input
                id="sched-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Weekly backup validation"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sched-title">Ticket title</Label>
              <Input
                id="sched-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Validate database backups"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sched-description">Ticket description</Label>
              <Textarea
                id="sched-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={3}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(value) =>
                    setForm({ ...form, frequency: value as RecurrenceFrequency })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {FREQUENCY_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {needsWeekday && (
                <div className="space-y-1.5">
                  <Label>Day of week</Label>
                  <Select
                    value={String(form.dayOfWeek ?? 1)}
                    onValueChange={(value) => setForm({ ...form, dayOfWeek: Number(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_LABELS.map((day, index) => (
                        <SelectItem key={day} value={String(index)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {needsMonthDay && (
                <div className="space-y-1.5">
                  <Label htmlFor="sched-dom">Day of month</Label>
                  <Input
                    id="sched-dom"
                    type="number"
                    min={1}
                    max={31}
                    value={form.dayOfMonth ?? 1}
                    onChange={(event) =>
                      setForm({ ...form, dayOfMonth: Number(event.target.value) })
                    }
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="sched-due">Due after (days)</Label>
                <Input
                  id="sched-due"
                  type="number"
                  min={0}
                  max={365}
                  value={form.dueInDays ?? ''}
                  placeholder="None"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      dueInDays: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <DatePicker
                  value={form.startDate}
                  onChange={(date) => date && setForm({ ...form, startDate: date })}
                  clearable={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <DatePicker
                  value={form.endDate}
                  onChange={(endDate) => setForm({ ...form, endDate })}
                  placeholder="Never"
                />
              </div>
            </div>

            {/* Schedule preview */}
            {preview.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium">Next occurrences</p>
                <ul className="mt-1.5 space-y-0.5">
                  {preview.map((date) => (
                    <li key={date.toISOString()} className="text-xs text-muted-foreground">
                      {date.toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <ConfigSelect
                  options={config.statuses}
                  value={form.statusId}
                  onChange={(statusId) => setForm({ ...form, statusId })}
                  placeholder="Status"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <PrioritySelect
                  options={config.priorities}
                  value={form.priorityId}
                  onChange={(priorityId) => setForm({ ...form, priorityId })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <ConfigSelect
                  options={config.types}
                  value={form.typeId}
                  onChange={(typeId) => setForm({ ...form, typeId })}
                  placeholder="Type"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <UserPicker
                users={config.members}
                value={form.assigneeId}
                onChange={(assigneeId) => setForm({ ...form, assigneeId })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Labels</Label>
              <LabelMultiSelect
                options={config.labels}
                value={form.labelIds}
                onChange={(labelIds) => setForm({ ...form, labelIds })}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending || !form.name.trim() || !form.title.trim()}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {schedule ? 'Save schedule' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blankForm(config: RecurringConfig) {
  return {
    name: '',
    title: '',
    description: '',
    statusId: config.statuses[0]?.id ?? '',
    priorityId: config.priorities[Math.floor(config.priorities.length / 2)]?.id ?? config.priorities[0]?.id ?? '',
    typeId: config.types[0]?.id ?? '',
    assigneeId: null as string | null,
    labelIds: [] as string[],
    frequency: 'WEEKLY' as RecurrenceFrequency,
    interval: 1,
    dayOfWeek: 1 as number | null,
    dayOfMonth: null as number | null,
    dueInDays: null as number | null,
    startDate: new Date(),
    endDate: null as Date | null,
    isActive: true,
  }
}

function fromSchedule(schedule: RecurringRow) {
  return {
    name: schedule.name,
    title: schedule.title,
    description: schedule.description ?? '',
    statusId: schedule.statusId,
    priorityId: schedule.priorityId,
    typeId: schedule.typeId,
    assigneeId: schedule.assigneeId,
    labelIds: schedule.labelIds,
    frequency: schedule.frequency,
    interval: schedule.interval,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    dueInDays: schedule.dueInDays,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    isActive: schedule.isActive,
  }
}
