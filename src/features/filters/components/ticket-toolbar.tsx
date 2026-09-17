'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Check, Filter, Plus, Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { ColorDot } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  CreateTicketDialog,
  type TicketFormConfig,
} from '@/features/tickets/components/create-ticket-dialog'
import { SaveFilterDialog } from './save-filter-dialog'
import { countActiveFilters, type TicketFilters } from '../types'

/**
 * Minimal shape the toolbar needs, so it serves both a single project and the
 * cross-project views.
 *
 * In the workspace scope an option's `id` may be several comma-joined ids (the
 * same status exists once per project), which is why selection is compared with
 * `isSelected` rather than a plain `includes`.
 */
export interface ToolbarOption {
  id: string
  name: string
  color: string
}

export interface ToolbarContext {
  statuses: ToolbarOption[]
  priorities: Array<ToolbarOption & { level: number }>
  types: ToolbarOption[]
  labels: ToolbarOption[]
  members: Array<{ id: string; name: string; username: string; avatarColor: string }>
  can: { createTicket: boolean }
  formConfig?: TicketFormConfig
  projectId?: string
}

/** True when every id in a (possibly grouped) option is present. */
function isSelected(selected: string[], optionId: string): boolean {
  const parts = optionId.split(',')
  return parts.every((part) => selected.includes(part))
}

/**
 * Filter toolbar shared by the board, table, calendar and timeline.
 *
 * Filters live in the URL, so any view is shareable and the browser's back
 * button behaves. Every control writes to searchParams; the server components
 * re-read them.
 */
export function TicketToolbar({
  context,
  filters,
  total,
}: {
  context: ToolbarContext
  filters: TicketFilters
  total: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [search, setSearch] = React.useState(filters.search ?? '')

  const activeCount = countActiveFilters(filters)

  const setParam = React.useCallback(
    (key: string, values: string[]) => {
      const next = new URLSearchParams(searchParams.toString())
      if (values.length === 0) next.delete(key)
      else next.set(key, values.join(','))
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const toggleParam = React.useCallback(
    (key: string, value: string) => {
      const current = (searchParams.get(key) ?? '').split(',').filter(Boolean)
      // `value` may itself be several comma-joined ids in the workspace scope,
      // so the whole group is added or removed together.
      const parts = value.split(',')
      const allPresent = parts.every((part) => current.includes(part))

      const next = allPresent
        ? current.filter((v) => !parts.includes(v))
        : [...current, ...parts.filter((part) => !current.includes(part))]

      setParam(key, next)
    },
    [searchParams, setParam],
  )

  // Debounce the search box so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.search ?? '') === search) return
      const next = new URLSearchParams(searchParams.toString())
      if (search) next.set('q', search)
      else next.delete('q')
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }, 350)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  function clearAll() {
    setSearch('')
    router.replace(pathname, { scroll: false })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tickets…"
            className="h-8 pl-8 text-sm"
            aria-label="Search tickets"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Status */}
        <FilterPopover
          label="Status"
          selectedCount={filters.statusIds.length}
          items={context.statuses.map((status) => ({
            id: status.id,
            label: status.name,
            color: status.color,
          }))}
          selected={filters.statusIds}
          onToggle={(id) => toggleParam('status', id)}
          onClear={() => setParam('status', [])}
        />

        {/* Priority */}
        <FilterPopover
          label="Priority"
          selectedCount={filters.priorityIds.length}
          items={context.priorities.map((priority) => ({
            id: priority.id,
            label: priority.name,
            color: priority.color,
          }))}
          selected={filters.priorityIds}
          onToggle={(id) => toggleParam('priority', id)}
          onClear={() => setParam('priority', [])}
        />

        {/* Type */}
        <FilterPopover
          label="Type"
          selectedCount={filters.typeIds.length}
          items={context.types.map((type) => ({
            id: type.id,
            label: type.name,
            color: type.color,
          }))}
          selected={filters.typeIds}
          onToggle={(id) => toggleParam('type', id)}
          onClear={() => setParam('type', [])}
        />

        {/* Labels */}
        <FilterPopover
          label="Labels"
          selectedCount={filters.labelIds.length}
          items={context.labels.map((label) => ({
            id: label.id,
            label: label.name,
            color: label.color,
          }))}
          selected={filters.labelIds}
          onToggle={(id) => toggleParam('label', id)}
          onClear={() => setParam('label', [])}
          emptyMessage="This project has no labels yet."
        />

        {/* Assignee */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn('h-8 gap-1.5', filters.assigneeIds.length > 0 && 'border-primary')}
            >
              Assignee
              {filters.assigneeIds.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {filters.assigneeIds.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search people…" />
              <CommandList>
                <CommandEmpty>No one found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="unassigned" onSelect={() => toggleParam('assignee', 'none')}>
                    <span className="size-5 rounded-full border border-dashed" />
                    Unassigned
                    <Check
                      className={cn(
                        'ml-auto size-4',
                        filters.assigneeIds.includes('none') ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                  {context.members.map((member) => (
                    <CommandItem
                      key={member.id}
                      value={member.name}
                      onSelect={() => toggleParam('assignee', member.id)}
                    >
                      <UserAvatar name={member.name} color={member.avatarColor} size="xs" />
                      <span className="flex-1 truncate">{member.name}</span>
                      <Check
                        className={cn(
                          'ml-auto size-4',
                          filters.assigneeIds.includes(member.id) ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
                {filters.assigneeIds.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem onSelect={() => setParam('assignee', [])}>
                        <X className="size-4" /> Clear
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Quick toggles */}
        <Button
          variant={filters.overdueOnly ? 'default' : 'outline'}
          size="sm"
          className="h-8"
          onClick={() => {
            const next = new URLSearchParams(searchParams.toString())
            if (filters.overdueOnly) next.delete('overdue')
            else next.set('overdue', '1')
            router.replace(`${pathname}?${next.toString()}`, { scroll: false })
          }}
        >
          Overdue
        </Button>

        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={clearAll}>
            <X className="size-3.5" />
            Clear
          </Button>
        )}

        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {total} {total === 1 ? 'ticket' : 'tickets'}
          </span>

          <SaveFilterDialog filters={filters} projectId={context.projectId} />

          {context.can.createTicket && context.formConfig && (
            <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New ticket
            </Button>
          )}
        </span>
      </div>

      {context.formConfig && (
        <CreateTicketDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          config={context.formConfig}
        />
      )}
    </>
  )
}

function FilterPopover({
  label,
  items,
  selected,
  onToggle,
  onClear,
  selectedCount,
  emptyMessage = 'Nothing to filter by.',
}: {
  label: string
  items: Array<{ id: string; label: string; color: string }>
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  selectedCount: number
  emptyMessage?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 gap-1.5', selectedCount > 0 && 'border-primary')}
        >
          {selectedCount === 0 && <Filter className="size-3.5" />}
          {label}
          {selectedCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {selectedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem key={item.id} value={item.label} onSelect={() => onToggle(item.id)}>
                  <ColorDot color={item.color} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      isSelected(selected, item.id) ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            {selectedCount > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={onClear}>
                    <X className="size-4" /> Clear
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
