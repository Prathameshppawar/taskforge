'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorPicker } from '@/components/shared/color-picker'
import { LabelChip } from '@/components/shared/badges'
import { EmptyState } from '@/components/shared/page-header'
import {
  createLabelAction,
  deleteLabelAction,
  importLabelsAction,
  updateLabelAction,
} from '../actions'

export interface ManagedLabel {
  id: string
  name: string
  color: string
  description: string | null
  ticketCount: number
}

export interface ImportSource {
  id: string
  name: string
  code: string
  labelCount: number
}

export function LabelManager({
  projectId,
  labels,
  sources,
  canEdit,
}: {
  projectId: string
  labels: ManagedLabel[]
  sources: ImportSource[]
  canEdit: boolean
}) {
  const [editing, setEditing] = React.useState<ManagedLabel | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ManagedLabel | null>(null)

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New label
          </Button>
          {sources.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <Download className="size-4" />
              Import from another project
            </Button>
          )}
        </div>
      )}

      {labels.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No labels yet"
          description="Labels are specific to this project. Create them here, or import a set from another project."
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {labels.map((label) => (
            <li key={label.id} className="group flex items-center gap-3 p-3">
              <LabelChip name={label.name} color={label.color} />

              <div className="min-w-0 flex-1">
                {label.description && (
                  <p className="truncate text-xs text-muted-foreground">{label.description}</p>
                )}
              </div>

              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {label.ticketCount} {label.ticketCount === 1 ? 'ticket' : 'tickets'}
              </span>

              {canEdit && (
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setEditing(label)}
                    aria-label={`Edit ${label.name}`}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 hover:text-destructive"
                    onClick={() => setDeleting(label)}
                    aria-label={`Delete ${label.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <LabelDialog
        projectId={projectId}
        label={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />

      <ImportDialog
        projectId={projectId}
        sources={sources}
        open={importing}
        onOpenChange={setImporting}
      />

      <DeleteLabelDialog
        projectId={projectId}
        label={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </div>
  )
}

function LabelDialog({
  projectId,
  label,
  open,
  onOpenChange,
}: {
  projectId: string
  label: ManagedLabel | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState('slate')
  const [description, setDescription] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    setName(label?.name ?? '')
    setColor(label?.color ?? 'blue')
    setDescription(label?.description ?? '')
  }, [open, label])

  function submit() {
    startTransition(async () => {
      const result = label
        ? await updateLabelAction({ id: label.id, projectId, name, color, description })
        : await createLabelAction({ projectId, name, color, description })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(label ? 'Label updated.' : 'Label created.')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label ? 'Edit label' : 'New label'}</DialogTitle>
          <DialogDescription>
            Labels belong to this project. Other projects have their own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="label-name">Name</Label>
            <Input
              id="label-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Backend-1"
              autoFocus
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="label-description">Description</Label>
            <Input
              id="label-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label>Colour</Label>
            <ColorPicker value={color} onChange={setColor} />
            <div className="pt-1">
              <LabelChip name={name || 'Preview'} color={color} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {label ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({
  projectId,
  sources,
  open,
  onOpenChange,
}: {
  projectId: string
  sources: ImportSource[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [sourceId, setSourceId] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const result = await importLabelsAction({
        targetProjectId: projectId,
        sourceProjectId: sourceId,
        labelIds: [],
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(
        result.data.skipped > 0
          ? `Imported ${result.data.imported} labels · ${result.data.skipped} already existed.`
          : `Imported ${result.data.imported} labels.`,
      )
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import labels</DialogTitle>
          <DialogDescription>
            Copies a project&apos;s labels into this one. Names that already exist here are
            skipped, never overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="source-project">Source project</Label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger id="source-project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name} ({source.labelCount} labels)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !sourceId}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteLabelDialog({
  projectId,
  label,
  onOpenChange,
}: {
  projectId: string
  label: ManagedLabel | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function remove() {
    if (!label) return
    startTransition(async () => {
      const result = await deleteLabelAction({ id: label.id, projectId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Deleted "${label.name}".`)
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <AlertDialog open={label !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{label?.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {label && label.ticketCount > 0
              ? `This label is on ${label.ticketCount} ${
                  label.ticketCount === 1 ? 'ticket' : 'tickets'
                }. They will keep their other labels — only this one is removed. This cannot be undone.`
              : 'This cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              remove()
            }}
            disabled={isPending}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Delete label
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
