'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateBillingSettingsAction } from '../config-actions'

/** What an hour of this project is billed at, for the monthly client report. */
export function BillingSettings({
  projectId,
  hourlyRate,
  currency,
  canEdit,
}: {
  projectId: string
  hourlyRate: number | null
  currency: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [rate, setRate] = React.useState(hourlyRate === null ? '' : String(hourlyRate))
  const [code, setCode] = React.useState(currency)
  const [isPending, startTransition] = React.useTransition()

  return (
    <section className="space-y-3" aria-labelledby="billing-heading">
      <div>
        <h2 id="billing-heading" className="text-sm font-semibold">Billing</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Billable hours appear in the monthly client report; with a rate, so does the amount.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hourly-rate">Hourly rate</Label>
          <Input
            id="hourly-rate"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="Hours only"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            disabled={!canEdit || isPending}
            className="w-36"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            value={code}
            maxLength={3}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            disabled={!canEdit || isPending}
            className="w-20 uppercase"
          />
        </div>
        {canEdit && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateBillingSettingsAction({
                  projectId,
                  hourlyRate: rate.trim() ? Number(rate) : null,
                  currency: code,
                })
                if (!result.success) toast.error(result.error)
                else {
                  toast.success('Billing saved.')
                  router.refresh()
                }
              })
            }
          >
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        )}
      </div>
    </section>
  )
}
