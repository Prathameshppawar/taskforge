'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  addCriteriaAction,
  editCriterionAction,
  moveCriterionAction,
  removeCriterionAction,
  toggleCriterionAction,
} from '../checklist-actions'

export interface CriterionView {
  id: string
  text: string
  isDone: boolean
  position: number
  doneAt: Date | null
  doneBy: { name: string } | null
}

/**
 * The ticket's acceptance criteria: what must be true for it to be done.
 *
 * Ticks are optimistic — the box changes at once and snaps back if the server
 * refuses — because a checklist that lags feels broken. Everything else waits
 * for the server.
 */
export function AcceptanceCriteria({
  ticketId,
  items,
  canEdit,
}: {
  ticketId: string
  items: CriterionView[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [optimistic, setOptimistic] = React.useState<Record<string, boolean>>({})
  const [draft, setDraft] = React.useState('')
  const [adding, startAdding] = React.useTransition()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editText, setEditText] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)

  React.useEffect(() => setOptimistic({}), [items])

  const view = items.map((item) => ({ ...item, isDone: optimistic[item.id] ?? item.isDone }))
  const done = view.filter((item) => item.isDone).length

  if (!canEdit && items.length === 0) return null

  async function toggle(item: CriterionView, isDone: boolean) {
    setOptimistic((current) => ({ ...current, [item.id]: isDone }))
    const result = await toggleCriterionAction({ itemId: item.id, isDone })
    if (!result.success) {
      setOptimistic((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      toast.error(result.error)
      return
    }
    router.refresh()
  }

  function add() {
    const text = draft.trim()
    if (!text) return
    startAdding(async () => {
      const result = await addCriteriaAction({ ticketId, texts: [text] })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDraft('')
      router.refresh()
    })
  }

  async function run(itemId: string, action: () => Promise<{ success: boolean; error?: string }>) {
    setBusyId(itemId)
    const result = await action()
    setBusyId(null)
    if (!result.success) {
      toast.error(result.error ?? 'That did not work.')
      return false
    }
    router.refresh()
    return true
  }

  async function saveEdit(item: CriterionView) {
    const text = editText.trim()
    setEditingId(null)
    if (!text || text === item.text) return
    await run(item.id, () => editCriterionAction({ itemId: item.id, text }))
  }

  function move(index: number, direction: -1 | 1) {
    const item = view[index]
    const target = index + direction
    if (target < 0 || target >= view.length) return
    // Moving up lands between the item two above and the one above; down,
    // between the one below and the one after it.
    const before = direction === -1 ? (view[target - 1]?.position ?? null) : view[target].position
    const after = direction === -1 ? view[target].position : (view[target + 1]?.position ?? null)
    void run(item.id, () => moveCriterionAction({ itemId: item.id, beforePosition: before, afterPosition: after }))
  }

  return (
    <section className="space-y-2" aria-labelledby="criteria-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="criteria-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <ListChecks className="size-4 text-muted-foreground" />
          Acceptance criteria
        </h2>
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {done} of {items.length} met
          </span>
        )}
      </div>

      {items.length > 0 && <Progress value={(done / items.length) * 100} className="h-1.5" aria-label={`${done} of ${items.length} criteria met`} />}

      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          What must be true for this to be done? The Coder works against these, and the Reviewer checks every pull request against each one.
        </p>
      )}

      <ul className="space-y-0.5">
        {view.map((item, index) => (
          <li key={item.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-accent/40">
            <Checkbox
              checked={item.isDone}
              onCheckedChange={(value) => toggle(item, value === true)}
              disabled={!canEdit}
              aria-label={item.isDone ? `Mark “${item.text}” as not met` : `Mark “${item.text}” as met`}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              {editingId === item.id ? (
                <Input
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  onBlur={() => saveEdit(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveEdit(item)
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  className="h-7 text-sm"
                  aria-label="Criterion"
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => {
                    setEditingId(item.id)
                    setEditText(item.text)
                  }}
                  className={cn(
                    'w-full text-left text-sm leading-snug disabled:cursor-default',
                    item.isDone && 'text-muted-foreground line-through',
                  )}
                >
                  {item.text}
                </button>
              )}
              {item.isDone && item.doneBy && optimistic[item.id] === undefined && (
                <p className="text-[11px] text-muted-foreground">
                  met · {item.doneBy.name}
                  {item.doneAt ? ` · ${new Date(item.doneAt).toLocaleDateString()}` : ''}
                </p>
              )}
            </div>
            {canEdit && editingId !== item.id && (
              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                {busyId === item.id ? (
                  <Loader2 className="m-1.5 size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Button variant="ghost" size="icon" className="size-6" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-6" disabled={index === view.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 hover:text-destructive"
                      onClick={() => run(item.id, () => removeCriterionAction(item.id))}
                      aria-label={`Remove “${item.text}”`}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              // A pasted list becomes several criteria at once.
              const text = event.clipboardData.getData('text')
              if (!text.includes('\n')) return
              event.preventDefault()
              startAdding(async () => {
                const result = await addCriteriaAction({ ticketId, texts: [text] })
                if (!result.success) toast.error(result.error)
                else {
                  toast.success(`Added ${result.data.added} criteria.`)
                  router.refresh()
                }
              })
            }}
            placeholder="Add a criterion — paste a list to add several"
            className="h-8 text-sm"
            aria-label="New acceptance criterion"
            disabled={adding}
          />
          <Button type="submit" size="sm" variant="outline" disabled={adding || !draft.trim()}>
            {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add
          </Button>
        </form>
      )}
    </section>
  )
}
