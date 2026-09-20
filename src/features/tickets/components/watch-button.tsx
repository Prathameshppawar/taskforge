'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { toggleWatchAction } from '../actions'

/**
 * Follow a ticket without being assigned to it.
 *
 * Gated on *viewing* rather than editing: the people who most need to keep an
 * eye on something — a manager, whoever raised it — are often exactly the
 * people who should not be changing it.
 */
export function WatchButton({
  ticketId,
  watching,
  watcherCount,
}: {
  ticketId: string
  watching: boolean
  watcherCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  // Flipped straight away so the button does not sit there looking broken while
  // the round trip happens.
  const [optimistic, setOptimistic] = React.useState(watching)

  React.useEffect(() => setOptimistic(watching), [watching])

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      disabled={isPending}
      aria-pressed={optimistic}
      onClick={() =>
        startTransition(async () => {
          setOptimistic((current) => !current)
          const result = await toggleWatchAction(ticketId)
          if (!result.success) {
            setOptimistic(watching)
            toast.error(result.error)
            return
          }
          toast.success(result.data.watching ? 'Following this ticket.' : 'Stopped following.')
          router.refresh()
        })
      }
    >
      {optimistic ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      <span className="text-xs">{optimistic ? 'Following' : 'Follow'}</span>
      {watcherCount > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{watcherCount}</span>
      )}
    </Button>
  )
}
