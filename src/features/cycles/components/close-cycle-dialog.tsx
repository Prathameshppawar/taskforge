'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { closeCycleAction } from '../actions'

export function CloseCycleDialog({
  cycle,
  others,
  unfinished,
  onClose,
}: {
  cycle: { id: string; name: string } | null
  others: Array<{ id: string; name: string }>
  unfinished: number
  onClose: () => void
}) {
  const router = useRouter()
  const [carryTo, setCarryTo] = React.useState('backlog')
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (cycle) setCarryTo(others[0]?.id ?? 'backlog')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle])

  function submit() {
    if (!cycle) return
    startTransition(async () => {
      const result = await closeCycleAction({ cycleId: cycle.id, carryTo })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${cycle.name} closed: ${result.data.completed} finished, ${result.data.carried} carried over.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={cycle !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close {cycle?.name}</DialogTitle>
          <DialogDescription>
            {unfinished === 0
              ? 'Everything in it is finished.'
              : `${unfinished} ${unfinished === 1 ? 'ticket is' : 'tickets are'} not finished. They move on; the cycle keeps a record of what carried over.`}
          </DialogDescription>
        </DialogHeader>
        {unfinished > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="carry-to">Move unfinished tickets to</Label>
            <Select value={carryTo} onValueChange={setCarryTo}>
              <SelectTrigger id="carry-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {others.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {other.name}
                  </SelectItem>
                ))}
                <SelectItem value="backlog">The backlog</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Close {cycle?.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
