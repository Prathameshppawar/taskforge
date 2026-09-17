'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { StatusCategory } from '@prisma/client'
import { Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { CATEGORY_LABELS } from '@/core/domain/ticket-rules'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorPicker } from '@/components/shared/color-picker'
import { ColorDot, PriorityBadge, StatusBadge } from '@/components/shared/badges'
import {
  deletePriorityAction,
  deleteStatusAction,
  deleteTicketTypeAction,
  upsertPriorityAction,
  upsertStatusAction,
  upsertTicketTypeAction,
} from '../config-actions'

export interface ConfigRow {
  id: string
  name: string
  color: string
  ticketCount: number
  isDefault?: boolean
  isInitial?: boolean
  category?: StatusCategory
  level?: number
  icon?: string
}

type ConfigKind = 'status' | 'priority' | 'type'

const KIND_LABELS: Record<ConfigKind, { singular: string; plural: string; hint: string }> = {
  status: {
    singular: 'status',
    plural: 'Statuses',
    hint: 'Board columns. The category drives progress rollup and the dashboards.',
  },
  priority: {
    singular: 'priority',
    plural: 'Priorities',
    hint: 'Higher levels sort first. Level must be unique within the project.',
  },
  type: {
    singular: 'ticket type',
    plural: 'Ticket types',
    hint: 'Task, Bug, Story and anything else this team tracks.',
  },
}

export function WorkflowConfig({
  projectId,
  kind,
  rows,
  canEdit,
}: {
  projectId: string
  kind: ConfigKind
  rows: ConfigRow[]
  canEdit: boolean
}) {
  const [editing, setEditing] = React.useState<ConfigRow | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ConfigRow | null>(null)

  const meta = KIND_LABELS[kind]

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{meta.plural}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Add
          </Button>
        )}
      </div>

      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id} className="group flex items-center gap-3 p-2.5">
            {kind === 'priority' ? (
              <PriorityBadge name={row.name} color={row.color} level={row.level ?? 1} />
            ) : kind === 'status' ? (
              <StatusBadge name={row.name} color={row.color} />
            ) : (
              <span className="flex items-center gap-2 text-sm">
                <ColorDot color={row.color} />
                {row.name}
              </span>
            )}

            {row.category && (
              <Badge variant="outline" className="text-[10px]">
                {CATEGORY_LABELS[row.category]}
              </Badge>
            )}
            {row.isInitial && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Star className="size-2.5" /> Initial
              </Badge>
            )}
            {row.isDefault && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Star className="size-2.5" /> Default
              </Badge>
            )}

            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {row.ticketCount}
            </span>

            {canEdit && (
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setEditing(row)}
                  aria-label={`Edit ${row.name}`}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 hover:text-destructive"
                  onClick={() => setDeleting(row)}
                  disabled={rows.length <= 1}
                  aria-label={`Delete ${row.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfigDialog
        projectId={projectId}
        kind={kind}
        row={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />

      <DeleteConfigDialog
        projectId={projectId}
        kind={kind}
        row={deleting}
        alternatives={rows.filter((r) => r.id !== deleting?.id)}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </section>
  )
}

function ConfigDialog({
  projectId,
  kind,
  row,
  open,
  onOpenChange,
}: {
  projectId: string
  kind: ConfigKind
  row: ConfigRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState('blue')
  const [category, setCategory] = React.useState<StatusCategory>('TODO')
  const [level, setLevel] = React.useState(1)
  const [flag, setFlag] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    setName(row?.name ?? '')
    setColor(row?.color ?? 'blue')
    setCategory(row?.category ?? 'TODO')
    setLevel(row?.level ?? 1)
    setFlag(Boolean(row?.isDefault ?? row?.isInitial))
  }, [open, row])

  function submit() {
    startTransition(async () => {
      const result =
        kind === 'status'
          ? await upsertStatusAction({
              id: row?.id,
              projectId,
              name,
              category,
              color,
              isInitial: flag,
            })
          : kind === 'priority'
            ? await upsertPriorityAction({
                id: row?.id,
                projectId,
                name,
                color,
                level,
                isDefault: flag,
              })
            : await upsertTicketTypeAction({
                id: row?.id,
                projectId,
                name,
                color,
                icon: row?.icon ?? 'circle-dot',
                isDefault: flag,
              })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(row ? 'Updated.' : 'Added.')
      onOpenChange(false)
      router.refresh()
    })
  }

  const meta = KIND_LABELS[kind]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {row ? `Edit ${meta.singular}` : `New ${meta.singular}`}
          </DialogTitle>
          <DialogDescription>{meta.hint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="config-name">Name</Label>
            <Input
              id="config-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
          </div>

          {kind === 'status' && (
            <div className="space-y-1.5">
              <Label htmlFor="config-category">Category</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as StatusCategory)}
              >
                <SelectTrigger id="config-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as StatusCategory[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {CATEGORY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Tickets in a <strong>Done</strong> or <strong>Cancelled</strong> status count as
                finished for rollup and dashboards.
              </p>
            </div>
          )}

          {kind === 'priority' && (
            <div className="space-y-1.5">
              <Label htmlFor="config-level">Level</Label>
              <Input
                id="config-level"
                type="number"
                min={1}
                max={99}
                value={level}
                onChange={(event) => setLevel(Number(event.target.value))}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Colour</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="config-flag">
                {kind === 'status' ? 'Use for new tickets' : 'Make this the default'}
              </Label>
              <p className="text-xs text-muted-foreground">
                {kind === 'status'
                  ? 'New tickets start in this status.'
                  : `New tickets get this ${meta.singular} unless another is chosen.`}
              </p>
            </div>
            <Switch id="config-flag" checked={flag} onCheckedChange={setFlag} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {row ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteConfigDialog({
  projectId,
  kind,
  row,
  alternatives,
  onOpenChange,
}: {
  projectId: string
  kind: ConfigKind
  row: ConfigRow | null
  alternatives: ConfigRow[]
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [replacementId, setReplacementId] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (row) setReplacementId(alternatives[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row])

  function submit() {
    if (!row) return

    startTransition(async () => {
      const payload = { projectId, id: row.id, replacementId }
      const result =
        kind === 'status'
          ? await deleteStatusAction(payload)
          : kind === 'priority'
            ? await deletePriorityAction(payload)
            : await deleteTicketTypeAction(payload)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(`Deleted "${row.name}".`)
      onOpenChange(false)
      router.refresh()
    })
  }

  const meta = KIND_LABELS[kind]

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{row?.name}&rdquo;</DialogTitle>
          <DialogDescription>
            {row && row.ticketCount > 0
              ? `${row.ticketCount} ${
                  row.ticketCount === 1 ? 'ticket uses' : 'tickets use'
                } this ${meta.singular}. Choose where they should move to.`
              : `Nothing is using this ${meta.singular}, but a replacement is still required so the project always has a valid fallback.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="replacement">Move tickets to</Label>
          <Select value={replacementId} onValueChange={setReplacementId}>
            <SelectTrigger id="replacement">
              <SelectValue placeholder={`Choose a ${meta.singular}`} />
            </SelectTrigger>
            <SelectContent>
              {alternatives.map((alt) => (
                <SelectItem key={alt.id} value={alt.id}>
                  {alt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={isPending || !replacementId}
            className={cn(!replacementId && 'opacity-50')}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Delete and move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
