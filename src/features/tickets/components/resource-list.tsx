'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ResourceType } from '@prisma/client'
import {
  BookOpen,
  ExternalLink,
  FileCode2,
  Figma,
  Github,
  Hammer,
  Link2,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { addResourceAction, removeResourceAction } from '../actions'

const RESOURCE_META: Record<
  ResourceType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  GITHUB: { label: 'GitHub', icon: Github },
  SHAREPOINT: { label: 'SharePoint', icon: BookOpen },
  FIGMA: { label: 'Figma', icon: Figma },
  BUILD: { label: 'Build', icon: Hammer },
  DOCUMENTATION: { label: 'Documentation', icon: BookOpen },
  API_SPEC: { label: 'API Spec', icon: FileCode2 },
  OTHER: { label: 'Other', icon: Link2 },
}

export interface ResourceItem {
  id: string
  name: string
  type: ResourceType
  url: string
  notes: string | null
}

/**
 * External resource links.
 *
 * The platform deliberately stores no uploads — only references to where the
 * artefact actually lives.
 */
export function ResourceList({
  ticketId,
  resources,
  canEdit,
}: {
  ticketId: string
  resources: ResourceItem[]
  canEdit: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4" />
          Resources
          {resources.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
              {resources.length}
            </span>
          )}
        </h2>
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        )}
      </div>

      {resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No links yet. Attach a repository, design file, build or spec.
        </p>
      ) : (
        <ul className="space-y-1">
          {resources.map((resource) => (
            <ResourceRow key={resource.id} resource={resource} canEdit={canEdit} />
          ))}
        </ul>
      )}

      <AddResourceDialog ticketId={ticketId} open={open} onOpenChange={setOpen} />
    </section>
  )
}

function ResourceRow({ resource, canEdit }: { resource: ResourceItem; canEdit: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const meta = RESOURCE_META[resource.type]
  const Icon = meta.icon

  return (
    <li className="group flex items-center gap-2 rounded-lg border p-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm font-medium hover:underline"
        >
          <span className="truncate">{resource.name}</span>
          <ExternalLink className="size-3 shrink-0 opacity-50" />
        </a>
        <p className="truncate text-[11px] text-muted-foreground">
          {resource.notes || resource.url}
        </p>
      </div>

      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {meta.label}
      </span>

      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
          disabled={isPending}
          aria-label={`Remove ${resource.name}`}
          onClick={() =>
            startTransition(async () => {
              const result = await removeResourceAction({ resourceId: resource.id })
              if (!result.success) toast.error(result.error)
              else router.refresh()
            })
          }
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      )}
    </li>
  )
}

function AddResourceDialog({
  ticketId,
  open,
  onOpenChange,
}: {
  ticketId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [name, setName] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [type, setType] = React.useState<ResourceType>('GITHUB')
  const [notes, setNotes] = React.useState('')

  function submit() {
    startTransition(async () => {
      const result = await addResourceAction({ ticketId, name, url, type, notes })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Resource linked.')
      setName('')
      setUrl('')
      setNotes('')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a resource</DialogTitle>
          <DialogDescription>
            TaskForge stores links, not files — point at where the artefact lives.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="resource-name">Name</Label>
            <Input
              id="resource-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Implementation branch"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resource-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as ResourceType)}>
              <SelectTrigger id="resource-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RESOURCE_META) as ResourceType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {RESOURCE_META[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resource-url">URL</Label>
            <Input
              id="resource-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/org/repo/pull/42"
              type="url"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resource-notes">Notes</Label>
            <Input
              id="resource-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !name.trim() || !url.trim()}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Add link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
