'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ColorDot, PriorityBadge, StatusBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { updateTicketAction } from '../actions'

/**
 * Inline editors for the table.
 *
 * Each shows its new value immediately and reverts if the Server Action
 * rejects, so a failed permission check does not leave a lie on screen.
 */

function useInlineUpdate<T>(initial: T) {
  const router = useRouter()
  const [value, setValue] = React.useState(initial)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => setValue(initial), [initial])

  const commit = React.useCallback(
    (next: T, apply: () => Promise<{ success: boolean; error?: string }>) => {
      const previous = value
      setValue(next)

      startTransition(async () => {
        const result = await apply()
        if (!result.success) {
          setValue(previous)
          toast.error(result.error ?? 'Could not save that change.')
          return
        }
        router.refresh()
      })
    },
    [value, router],
  )

  return { value, commit, isPending }
}

export function InlineStatusCell({
  ticketId,
  current,
  options,
}: {
  ticketId: string
  current: { id: string; name: string; color: string }
  options: Array<{ id: string; name: string; color: string }>
}) {
  const [open, setOpen] = React.useState(false)
  const { value, commit, isPending } = useInlineUpdate(current)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={cn(
            'group inline-flex items-center gap-1 rounded transition-opacity',
            isPending && 'opacity-50',
          )}
        >
          <StatusBadge name={value.name} color={value.color} />
          <ChevronDown className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder="Change status…" />
          <CommandList>
            <CommandEmpty>No status found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  onSelect={() => {
                    setOpen(false)
                    if (option.id === value.id) return
                    commit(option, () =>
                      updateTicketAction({ id: ticketId, statusId: option.id }),
                    )
                  }}
                >
                  <ColorDot color={option.color} />
                  <span className="flex-1 truncate">{option.name}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value.id === option.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function InlinePriorityCell({
  ticketId,
  current,
  options,
}: {
  ticketId: string
  current: { id: string; name: string; color: string; level: number }
  options: Array<{ id: string; name: string; color: string; level: number }>
}) {
  const [open, setOpen] = React.useState(false)
  const { value, commit, isPending } = useInlineUpdate(current)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={cn(
            'group inline-flex items-center gap-1 rounded transition-opacity',
            isPending && 'opacity-50',
          )}
        >
          <PriorityBadge name={value.name} color={value.color} level={value.level} />
          <ChevronDown className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  onSelect={() => {
                    setOpen(false)
                    if (option.id === value.id) return
                    commit(option, () =>
                      updateTicketAction({ id: ticketId, priorityId: option.id }),
                    )
                  }}
                >
                  <PriorityBadge
                    name={option.name}
                    color={option.color}
                    level={option.level}
                  />
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value.id === option.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function InlineAssigneeCell({
  ticketId,
  current,
  options,
}: {
  ticketId: string
  current: { id: string; name: string; avatarColor: string } | null
  options: Array<{ id: string; name: string; username: string; avatarColor: string }>
}) {
  const [open, setOpen] = React.useState(false)
  const { value, commit, isPending } = useInlineUpdate(current)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={cn(
            'group inline-flex w-full items-center gap-1.5 rounded text-left transition-opacity',
            isPending && 'opacity-50',
          )}
        >
          {value ? (
            <>
              <UserAvatar name={value.name} color={value.avatarColor} size="xs" />
              <span className="truncate text-xs">{value.name}</span>
            </>
          ) : (
            <>
              <span className="size-5 shrink-0 rounded-full border border-dashed" />
              <span className="text-xs text-muted-foreground">Unassigned</span>
            </>
          )}
          <ChevronDown className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="unassigned"
                onSelect={() => {
                  setOpen(false)
                  commit(null, () => updateTicketAction({ id: ticketId, assigneeId: null }))
                }}
              >
                <span className="size-5 rounded-full border border-dashed" />
                Unassigned
                <Check
                  className={cn('ml-auto size-4', value === null ? 'opacity-100' : 'opacity-0')}
                />
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.name} ${option.username}`}
                  onSelect={() => {
                    setOpen(false)
                    if (option.id === value?.id) return
                    commit(option, () =>
                      updateTicketAction({ id: ticketId, assigneeId: option.id }),
                    )
                  }}
                >
                  <UserAvatar name={option.name} color={option.avatarColor} size="xs" />
                  <span className="flex-1 truncate">{option.name}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value?.id === option.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
