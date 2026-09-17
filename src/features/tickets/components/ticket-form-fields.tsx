'use client'

import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
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
import { ColorDot, LabelChip, PriorityBadge } from '@/components/shared/badges'

export interface ConfigOption {
  id: string
  name: string
  color: string
}

export interface PriorityOption extends ConfigOption {
  level: number
}

/** Status / type picker. */
export function ConfigSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: ConfigOption[]
  value: string | undefined
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.id === value)

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
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <ColorDot color={selected.color} />
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
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  onSelect={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                >
                  <ColorDot color={option.color} />
                  <span className="flex-1 truncate">{option.name}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value === option.id ? 'opacity-100' : 'opacity-0',
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

export function PrioritySelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: PriorityOption[]
  value: string | undefined
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.id === value)

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
          {selected ? (
            <PriorityBadge
              name={selected.name}
              color={selected.color}
              level={selected.level}
            />
          ) : (
            <span className="text-muted-foreground">Priority</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  onSelect={() => {
                    onChange(option.id)
                    setOpen(false)
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
                      value === option.id ? 'opacity-100' : 'opacity-0',
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

export function LabelMultiSelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: ConfigOption[]
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selectedSet = new Set(value)
  const selected = options.filter((option) => selectedSet.has(option.id))

  function toggle(id: string) {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between gap-2 font-normal"
          >
            <span className={cn(selected.length === 0 && 'text-muted-foreground')}>
              {selected.length === 0 ? 'No labels' : `${selected.length} selected`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search labels…" />
            <CommandList>
              <CommandEmpty>No labels in this project.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.name}
                    onSelect={() => toggle(option.id)}
                  >
                    <span
                      className={cn('size-2.5 rounded-full', colorClasses(option.color).dot)}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{option.name}</span>
                    <Check
                      className={cn(
                        'ml-auto size-4',
                        selectedSet.has(option.id) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((label) => (
            <LabelChip
              key={label.id}
              name={label.name}
              color={label.color}
              onRemove={() => toggle(label.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
