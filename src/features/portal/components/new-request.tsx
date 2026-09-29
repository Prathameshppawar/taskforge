'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createTicketAction } from '@/features/tickets/actions'

/** File a request. It becomes an ordinary ticket, triaged by the team like any other. */
export function NewRequest({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New request
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What do you need?" className="text-sm" />
      <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Details: what happens now, what should happen, where." className="min-h-24 text-sm" />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isPending || title.trim().length < 3}
          onClick={() =>
            startTransition(async () => {
              const result = await createTicketAction({ projectId, title, description, labelIds: [], resources: [] })
              if (!result.success) {
                toast.error(result.error)
                return
              }
              toast.success('Request filed. The team will pick it up.')
              setTitle('')
              setDescription('')
              setOpen(false)
              router.refresh()
            })
          }
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Send request
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
