'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { approveTicketAction } from '../actions'

export function ApproveButton({ ticketKey }: { ticketKey: string }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  return (
    <Button
      size="sm"
      className="h-7"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(`Approve ${ticketKey}? It will be marked done.`)) return
        startTransition(async () => {
          const result = await approveTicketAction(ticketKey)
          if (!result.success) {
            toast.error(result.error)
            return
          }
          toast.success(`${ticketKey} approved.`)
          router.refresh()
        })
      }}
    >
      {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      Approve
    </Button>
  )
}
