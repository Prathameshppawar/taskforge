'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { TicketKind } from '@prisma/client'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { TICKET_KINDS, TICKET_KIND_LABELS } from '@/core/domain/git-refs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateFlowSettingsAction } from '../config-actions'

/**
 * Flow rules: when a ticket counts as stuck, and which kinds of ticket the
 * priorities' service targets apply to. The targets themselves live on each
 * priority, below.
 */
export function FlowSettings({
  projectId,
  stuckAfterDays,
  slaKinds,
  canEdit,
}: {
  projectId: string
  stuckAfterDays: number | null
  slaKinds: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [days, setDays] = React.useState(stuckAfterDays ? String(stuckAfterDays) : '')
  const [kinds, setKinds] = React.useState<Set<TicketKind>>(
    new Set(slaKinds.split(',').map((kind) => kind.trim()).filter(Boolean) as TicketKind[]),
  )
  const [isPending, startTransition] = React.useTransition()

  function save() {
    startTransition(async () => {
      const result = await updateFlowSettingsAction({
        projectId,
        stuckAfterDays: days.trim() ? Number(days) : null,
        slaKinds: [...kinds],
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Flow rules saved.')
      router.refresh()
    })
  }

  return (
    <section className="space-y-4" aria-labelledby="flow-heading">
      <div>
        <h2 id="flow-heading" className="text-sm font-semibold">Flow</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every status change is recorded, so the board can say what is stuck and each ticket shows where its time went.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="stuck-days">Flag a ticket as stuck after</Label>
        <div className="flex items-center gap-2">
          <Input
            id="stuck-days"
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            placeholder="Never"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            disabled={!canEdit || isPending}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">days in progress, review or blocked</span>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Service targets apply to</legend>
        <p className="text-xs text-muted-foreground">
          Set response and resolution hours on each priority. Alerts go to the assignee and the project’s managers at 80% and on breach.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TICKET_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={kinds.has(kind)}
                disabled={!canEdit || isPending}
                onCheckedChange={(value) =>
                  setKinds((current) => {
                    const next = new Set(current)
                    if (value === true) next.add(kind)
                    else next.delete(kind)
                    return next
                  })
                }
              />
              {TICKET_KIND_LABELS[kind].label}
            </label>
          ))}
        </div>
      </fieldset>

      {canEdit && (
        <Button size="sm" onClick={save} disabled={isPending}>
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          Save flow rules
        </Button>
      )}
    </section>
  )
}
