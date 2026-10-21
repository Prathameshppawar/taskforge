'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { approveProposalAction, rejectProposalAction } from '../actions'

const DEFAULT_STALE_MESSAGE =
  'This proposal was written against an older version. Compare carefully: approving replaces what is there now.'

/**
 * Approve or reject a pending proposal, with an optional note for its proposer.
 * When the target has moved on, approval needs the explicit "Approve anyway".
 */
export function ReviewPanel({ proposalId, stale, staleMessage }: { proposalId: string; stale: boolean; staleMessage?: string }) {
  const router = useRouter()
  const [note, setNote] = React.useState('')
  const [clicked, setClicked] = React.useState<'approve' | 'reject' | null>(null)
  const [pending, startTransition] = React.useTransition()

  function approve() {
    setClicked('approve')
    startTransition(async () => {
      const result = await approveProposalAction({ proposalId, note: note || undefined, acknowledgeStale: stale })
      if (!result.success) {
        toast.error(result.error)
        // Overtaken while the page was open: reload it so the diff and the
        // warning reflect what is there now.
        if (result.code === 'STALE') router.refresh()
        return
      }
      toast.success('Approved — the change has been applied.')
      router.refresh()
    })
  }

  function reject() {
    setClicked('reject')
    startTransition(async () => {
      const result = await rejectProposalAction({ proposalId, note: note || undefined })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Rejected.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {stale && (
        <div className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 break-words">{staleMessage ?? DEFAULT_STALE_MESSAGE}</p>
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="proposal-note" className="text-sm font-medium">
          Note for the proposer (optional)
        </label>
        <Textarea
          id="proposal-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          rows={3}
          disabled={pending}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={approve} disabled={pending}>
          {pending && clicked === 'approve' && <Loader2 className="size-4 animate-spin" />}
          {stale ? 'Approve anyway' : 'Approve and apply'}
        </Button>
        <Button variant="outline" onClick={reject} disabled={pending}>
          {pending && clicked === 'reject' && <Loader2 className="size-4 animate-spin" />}
          Reject
        </Button>
      </div>
    </div>
  )
}
