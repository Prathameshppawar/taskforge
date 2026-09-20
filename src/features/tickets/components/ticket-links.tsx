'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Link2, Plus, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import type { TicketLinkType } from '@prisma/client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { linkTicketsAction, unlinkTicketsAction } from '../actions'
import type { LinkedTicket } from '../relations'

const TYPES: Array<{ value: TicketLinkType; label: string }> = [
  { value: 'BLOCKS', label: 'blocks' },
  { value: 'RELATES_TO', label: 'relates to' },
  { value: 'DUPLICATES', label: 'duplicates' },
]

/**
 * Links between tickets.
 *
 * Grouped by how the relationship reads from *this* ticket, because "blocks"
 * and "is blocked by" are the same row and mean opposite things — showing them
 * in one undifferentiated list is how people act on the wrong one.
 */
export function TicketLinks({
  ticketKey,
  links,
  canEdit,
}: {
  ticketKey: string
  links: LinkedTicket[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [targetKey, setTargetKey] = React.useState('')
  const [type, setType] = React.useState<TicketLinkType>('BLOCKS')
  const [isPending, startTransition] = React.useTransition()

  const blockers = links.filter((link) => link.blocking)

  const groups = React.useMemo(() => {
    const map = new Map<string, LinkedTicket[]>()
    for (const link of links) {
      const existing = map.get(link.relation) ?? []
      existing.push(link)
      map.set(link.relation, existing)
    }
    return [...map.entries()]
  }, [links])

  function submit() {
    const target = targetKey.trim().toUpperCase()
    if (!target) return

    startTransition(async () => {
      const result = await linkTicketsAction({ ticketKey, targetKey: target, type })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Linked to ${target}.`)
      setTargetKey('')
      setAdding(false)
      router.refresh()
    })
  }

  if (links.length === 0 && !canEdit) return null

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Link2 className="size-4 text-muted-foreground" />
          Linked tickets
        </h2>
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Link
          </Button>
        )}
      </div>

      {/* Surfaced above the list: an unresolved blocker is the reason this
          ticket cannot move, which is the one thing worth seeing first. */}
      {blockers.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-xs">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600" />
          <span>
            Waiting on {blockers.map((link) => link.key).join(', ')} — this cannot finish
            until {blockers.length === 1 ? 'it is' : 'they are'} resolved.
          </span>
        </p>
      )}

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
          <span className="text-xs text-muted-foreground">This ticket</span>
          <Select value={type} onValueChange={(value) => setType(value as TicketLinkType)}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={targetKey}
            onChange={(event) => setTargetKey(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            placeholder="RC-14"
            className="h-7 w-28 font-mono text-xs"
            aria-label="Ticket key to link"
          />
          <Button size="sm" className="h-7" onClick={submit} disabled={isPending || !targetKey.trim()}>
            Link
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              setAdding(false)
              setTargetKey('')
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {links.length === 0 ? (
        !adding && (
          <p className="text-xs text-muted-foreground">
            Nothing linked. Use links to record what blocks this, or what it duplicates.
          </p>
        )
      ) : (
        <div className="space-y-2">
          {groups.map(([relation, entries]) => (
            <div key={relation}>
              <p className="pb-0.5 text-[11px] text-muted-foreground">{relation}</p>
              <ul className="divide-y rounded-md border">
                {entries.map((link) => (
                  <li key={link.linkId} className="flex items-center gap-2 px-2.5 py-1.5">
                    <Link
                      href={`/tickets/${link.key}`}
                      className="shrink-0 font-mono text-[11px] text-primary hover:underline"
                    >
                      {link.key}
                    </Link>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-xs',
                        link.isResolved && 'text-muted-foreground line-through',
                      )}
                    >
                      {link.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {link.statusName}
                    </span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 shrink-0 p-0 text-muted-foreground"
                        aria-label={`Remove link to ${link.key}`}
                        disabled={isPending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await unlinkTicketsAction(link.linkId)
                            if (!result.success) {
                              toast.error(result.error)
                              return
                            }
                            router.refresh()
                          })
                        }
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
