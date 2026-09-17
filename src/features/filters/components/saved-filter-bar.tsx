'use client'

import * as React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Bookmark, Loader2, Pin, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { deleteFilterAction, type SavedFilterItem } from '../actions'
import { filtersToSearchParams } from '../types'

/** Quick-apply strip for saved filter sets. */
export function SavedFilterBar({ filters }: { filters: SavedFilterItem[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = React.useTransition()

  if (filters.length === 0) return null

  function apply(filter: SavedFilterItem) {
    const params = filtersToSearchParams(filter.filters)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function remove(filter: SavedFilterItem) {
    startTransition(async () => {
      const result = await deleteFilterAction(filter.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Removed "${filter.name}".`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 sm:px-6">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bookmark className="size-3.5" />
        Saved
      </span>

      {filters.map((filter) => (
        <span key={filter.id} className="group relative">
          <Button
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1.5 pr-7 text-xs', filter.isPinned && 'border-primary/50')}
            onClick={() => apply(filter)}
            disabled={isPending}
          >
            {filter.isPinned && <Pin className="size-3" />}
            {filter.name}
            {filter.isShared && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Users className="size-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  Shared by {filter.isOwn ? 'you' : filter.owner.name}
                </TooltipContent>
              </Tooltip>
            )}
          </Button>

          {filter.isOwn && (
            <button
              type="button"
              onClick={() => remove(filter)}
              disabled={isPending}
              aria-label={`Delete saved filter ${filter.name}`}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
