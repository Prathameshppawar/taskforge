'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { CalendarIcon, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled,
  className,
  clearable = true,
}: {
  value?: Date | null
  onChange: (date: Date | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  clearable?: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start gap-2 font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{value ? format(value, 'd MMM yyyy') : placeholder}</span>
          {value && clearable && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              className="ml-auto rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onChange(null)
                }
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={(date) => {
            onChange(date ?? null)
            setOpen(false)
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
