'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bookmark, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { saveFilterAction } from '../actions'
import { countActiveFilters, type TicketFilters } from '../types'

export function SaveFilterDialog({
  filters,
  projectId,
}: {
  filters: TicketFilters
  projectId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [isShared, setIsShared] = React.useState(false)
  const [scopeToProject, setScopeToProject] = React.useState(Boolean(projectId))
  const [isPending, startTransition] = React.useTransition()

  const activeCount = countActiveFilters(filters)

  function handleSave() {
    if (!name.trim()) {
      toast.error('Give this filter set a name.')
      return
    }

    startTransition(async () => {
      const result = await saveFilterAction({
        name: name.trim(),
        projectId: scopeToProject ? (projectId ?? null) : null,
        isShared,
        isPinned: false,
        viewType: 'TABLE',
        filters,
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(`Saved "${name.trim()}".`)
      setOpen(false)
      setName('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={activeCount === 0}
          title={activeCount === 0 ? 'Apply a filter first' : 'Save this filter set'}
        >
          <Bookmark className="size-3.5" />
          <span className="hidden sm:inline">Save</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save filter set</DialogTitle>
          <DialogDescription>
            Saves the {activeCount} active {activeCount === 1 ? 'filter' : 'filters'} so you can
            reapply them in one click.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="filter-name">Name</Label>
            <Input
              id="filter-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Critical Bugs"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSave()
              }}
            />
          </div>

          {projectId && (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="scope">Limit to this project</Label>
                <p className="text-xs text-muted-foreground">
                  Otherwise it applies across every project you can see.
                </p>
              </div>
              <Switch id="scope" checked={scopeToProject} onCheckedChange={setScopeToProject} />
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="shared">Share with the team</Label>
              <p className="text-xs text-muted-foreground">
                Everyone sees it; only you can edit or delete it.
              </p>
            </div>
            <Switch id="shared" checked={isShared} onCheckedChange={setIsShared} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
