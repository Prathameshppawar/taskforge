'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { updateTicketAction } from '../actions'

export function EditableTitle({
  ticketId,
  value,
  canEdit,
  updatedAt,
}: {
  ticketId: string
  value: string
  canEdit: boolean
  /** Guards against overwriting a concurrent edit. */
  updatedAt?: Date
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => setDraft(value), [value])

  function save() {
    if (draft.trim() === value) {
      setEditing(false)
      return
    }

    startTransition(async () => {
      const result = await updateTicketAction({
        id: ticketId,
        title: draft.trim(),
        expectedUpdatedAt: updatedAt,
      })
      if (!result.success) {
        toast.error(result.error)
        setDraft(value)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  if (!canEdit) {
    return <h1 className="text-xl leading-tight font-semibold tracking-tight">{value}</h1>
  }

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <h1 className="text-xl leading-tight font-semibold tracking-tight">{value}</h1>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => setEditing(true)}
          aria-label="Edit title"
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="text-xl font-semibold"
        autoFocus
        disabled={isPending}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
          if (event.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
      />
      <Button size="icon" className="size-8 shrink-0" onClick={save} disabled={isPending}>
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        onClick={() => {
          setDraft(value)
          setEditing(false)
        }}
        disabled={isPending}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

export function EditableDescription({
  ticketId,
  value,
  canEdit,
  field = 'description',
  placeholder = 'Add a description…',
  updatedAt,
}: {
  ticketId: string
  value: string | null
  canEdit: boolean
  field?: 'description' | 'remarks'
  placeholder?: string
  /** Guards against overwriting a concurrent edit. */
  updatedAt?: Date
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => setDraft(value ?? ''), [value])

  function save() {
    startTransition(async () => {
      const result = await updateTicketAction({
        id: ticketId,
        [field]: draft.trim() || null,
        expectedUpdatedAt: updatedAt,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
          autoFocus
          disabled={isPending}
          placeholder={placeholder}
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(value ?? '')
              setEditing(false)
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={canEdit ? 'group cursor-text rounded-lg -m-2 p-2 hover:bg-accent/40' : undefined}
      onClick={() => canEdit && setEditing(true)}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={(event) => {
        if (canEdit && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          setEditing(true)
        }
      }}
    >
      {value ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          {canEdit ? placeholder : 'No description.'}
        </p>
      )}
    </div>
  )
}
