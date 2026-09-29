'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ScopeProposal } from '../actions'
import type { PlanTicket } from '../queries'

/**
 * A proposed scope, shown before anything moves. Every ticket can be
 * unticked; nothing is applied that the person did not see.
 */
export function ProposalDialog({
  value,
  tickets,
  onClose,
  onApply,
}: {
  value: { cycleId: string; cycleName: string; proposal: ScopeProposal } | null
  tickets: PlanTicket[]
  onClose: () => void
  onApply: (cycleId: string, keys: string[]) => Promise<boolean>
}) {
  const [keep, setKeep] = React.useState<Set<string>>(new Set())
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (value) setKeep(new Set(value.proposal.keys))
  }, [value])

  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]))
  const proposal = value?.proposal

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {proposal?.source === 'planner' ? 'The Planner suggests' : 'Fill to capacity'} · {value?.cycleName}
          </DialogTitle>
          <DialogDescription>
            {proposal && proposal.keys.length > 0
              ? `${proposal.keys.length} ${proposal.keys.length === 1 ? 'ticket' : 'tickets'} · ${proposal.load}${proposal.capacity ? ` of ${proposal.capacity}` : ''} ${proposal.unit} with what is already planned.`
              : 'Nothing from the backlog fits.'}
          </DialogDescription>
        </DialogHeader>

        {proposal && proposal.keys.length > 0 && (
          <ul className="space-y-1">
            {proposal.keys.map((key) => {
              const ticket = byKey.get(key)
              return (
                <li key={key}>
                  <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent/40">
                    <Checkbox
                      checked={keep.has(key)}
                      onCheckedChange={(checked) =>
                        setKeep((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{key}</span>
                    <span className="min-w-0 flex-1 truncate">{ticket?.title ?? ''}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{ticket?.storyPoints ?? '–'}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        {proposal && proposal.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {proposal.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={isPending || keep.size === 0 || !value}
            onClick={() =>
              value &&
              startTransition(async () => {
                if (await onApply(value.cycleId, [...keep])) onClose()
              })
            }
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Plan {keep.size} {keep.size === 1 ? 'ticket' : 'tickets'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
