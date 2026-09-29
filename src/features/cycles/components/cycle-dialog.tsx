'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/shared/date-picker'
import { createCycleAction, updateCycleAction } from '../actions'

export interface CycleFormValue {
  id?: string
  projectId: string
  kind: 'SPRINT' | 'MILESTONE'
  name?: string
  goal?: string | null
  startDate?: Date | null
  endDate?: Date | null
  capacity?: number | null
}

export function CycleDialog({
  value,
  onClose,
  unit,
}: {
  value: CycleFormValue | null
  onClose: () => void
  unit: 'points' | 'tickets'
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [goal, setGoal] = React.useState('')
  const [startDate, setStartDate] = React.useState<Date | null>(null)
  const [endDate, setEndDate] = React.useState<Date | null>(null)
  const [capacity, setCapacity] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!value) return
    setName(value.name ?? '')
    setGoal(value.goal ?? '')
    setStartDate(value.startDate ?? (value.id ? null : new Date()))
    // A new sprint defaults to two weeks; a milestone has no default date.
    setEndDate(value.endDate ?? (value.id || value.kind === 'MILESTONE' ? null : new Date(Date.now() + 13 * 86_400_000)))
    setCapacity(value.capacity ? String(value.capacity) : '')
  }, [value])

  const noun = value?.kind === 'MILESTONE' ? 'milestone' : 'sprint'

  function submit() {
    if (!value) return
    startTransition(async () => {
      const payload = {
        projectId: value.projectId,
        kind: value.kind,
        name: name.trim() || undefined,
        goal: goal.trim() || null,
        startDate,
        endDate,
        capacity: capacity.trim() ? Number(capacity) : null,
      }
      const result = value.id ? await updateCycleAction({ ...payload, id: value.id }) : await createCycleAction(payload)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(value.id ? 'Saved.' : `The ${noun} is planned. Drag tickets into it from the backlog.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{value?.id ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
          <DialogDescription>
            {value?.kind === 'MILESTONE'
              ? 'A goal with a date. Several milestones can be open at once.'
              : 'A timebox. One sprint runs at a time; plan the next while this one runs.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cycle-name">Name</Label>
            <Input id="cycle-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={value?.id ? '' : 'Numbered automatically if left empty'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cycle-goal">Goal</Label>
            <Textarea id="cycle-goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={2} placeholder="What this delivers, in one sentence" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Starts</Label>
              <DatePicker value={startDate} onChange={setStartDate} />
            </div>
            <div className="space-y-1.5">
              <Label>{value?.kind === 'MILESTONE' ? 'Due' : 'Ends'}</Label>
              <DatePicker value={endDate} onChange={setEndDate} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cycle-capacity">Capacity ({unit})</Label>
            <Input
              id="cycle-capacity"
              type="number"
              min={1}
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              placeholder="Optional"
              className="w-32"
            />
            <p className="text-[11px] text-muted-foreground">
              How much the team expects to finish. Used by Fill to capacity and the Planner; it never refuses a ticket.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {value?.id ? 'Save' : `Create ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
