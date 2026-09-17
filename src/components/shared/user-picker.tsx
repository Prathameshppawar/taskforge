'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, UserX } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { UserAvatar } from '@/components/shared/user-avatar'

export interface PickableUser {
  id: string
  name: string
  username: string
  avatarColor: string
  jobTitle?: string | null
}

/** Single-select user combobox, with an optional "Unassigned" entry. */
export function UserPicker({
  users,
  value,
  onChange,
  placeholder = 'Unassigned',
  allowUnassigned = true,
  disabled,
  className,
}: {
  users: PickableUser[]
  value: string | null
  onChange: (userId: string | null) => void
  placeholder?: string
  allowUnassigned?: boolean
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = users.find((user) => user.id === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between gap-2 font-normal', className)}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar name={selected.name} color={selected.avatarColor} size="xs" />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search people…" />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {allowUnassigned && (
                <CommandItem
                  value="unassigned"
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <UserX className="size-4 text-muted-foreground" />
                  Unassigned
                  <Check
                    className={cn('ml-auto size-4', value === null ? 'opacity-100' : 'opacity-0')}
                  />
                </CommandItem>
              )}

              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={`${user.name} ${user.username}`}
                  onSelect={() => {
                    onChange(user.id)
                    setOpen(false)
                  }}
                >
                  <UserAvatar name={user.name} color={user.avatarColor} size="xs" />
                  <span className="min-w-0 flex-1 truncate">
                    {user.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">@{user.username}</span>
                  </span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value === user.id ? 'opacity-100' : 'opacity-0',
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

/** Multi-select variant used for project membership. */
export function MultiUserPicker({
  users,
  value,
  onChange,
  placeholder = 'Add people',
  disabled,
}: {
  users: PickableUser[]
  value: string[]
  onChange: (userIds: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selectedSet = new Set(value)

  function toggle(userId: string) {
    const next = new Set(selectedSet)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onChange([...next])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between gap-2 font-normal"
        >
          <span className={cn(value.length === 0 && 'text-muted-foreground')}>
            {value.length === 0
              ? placeholder
              : `${value.length} ${value.length === 1 ? 'person' : 'people'} selected`}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search people…" />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={`${user.name} ${user.username}`}
                  onSelect={() => toggle(user.id)}
                >
                  <UserAvatar name={user.name} color={user.avatarColor} size="xs" />
                  <span className="min-w-0 flex-1 truncate">
                    {user.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">@{user.username}</span>
                  </span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      selectedSet.has(user.id) ? 'opacity-100' : 'opacity-0',
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
