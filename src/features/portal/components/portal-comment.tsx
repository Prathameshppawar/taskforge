'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createCommentAction } from '@/features/tickets/actions'

export function PortalComment({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [body, setBody] = React.useState('')
  const [isPending, startTransition] = React.useTransition()
  return (
    <div className="space-y-2">
      <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Reply to the team…" className="min-h-20 text-sm" />
      <Button
        size="sm"
        disabled={isPending || !body.trim()}
        onClick={() =>
          startTransition(async () => {
            const result = await createCommentAction({ ticketId, body })
            if (!result.success) {
              toast.error(result.error)
              return
            }
            setBody('')
            router.refresh()
          })
        }
      >
        {isPending && <Loader2 className="size-4 animate-spin" />}
        Send
      </Button>
    </div>
  )
}
