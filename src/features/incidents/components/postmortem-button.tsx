'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileWarning, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { draftPostmortemAction } from '../actions'

/** On Production tickets: have TaskForge Ops draft a blameless post-mortem from the record. */
export function PostmortemButton({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  return (
    <section className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileWarning className="size-4" />
        A production issue. Once it is understood, draft a post-mortem from this ticket&rsquo;s record.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await draftPostmortemAction(ticketId)
            if (!result.success) {
              toast.error(result.error)
              return
            }
            toast.success('Post-mortem draft posted as a comment.')
            router.refresh()
          })
        }
      >
        {isPending && <Loader2 className="size-3.5 animate-spin" />}
        Draft post-mortem
      </Button>
    </section>
  )
}
