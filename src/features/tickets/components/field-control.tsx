'use client'

import * as React from 'react'
import type { CustomFieldType } from '@prisma/client'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/date-picker'
import { UserPicker, type PickableUser } from '@/components/shared/user-picker'

export interface FieldView {
  id: string
  name: string
  type: CustomFieldType
  description: string | null
  options: string[]
  required: boolean
}

const CLEAR = '__clear__'

/**
 * One custom field's control, by type. `value` is the stored text (see
 * normaliseFieldValue); `onCommit` receives what should be stored next.
 * Text-like inputs commit on blur or Enter, so typing is one change.
 */
export function FieldControl({
  field,
  value,
  onCommit,
  members,
  disabled,
  id,
}: {
  field: FieldView
  value: string | null
  onCommit: (value: unknown) => void
  members: PickableUser[]
  disabled?: boolean
  id?: string
}) {
  const [draft, setDraft] = React.useState(value ?? '')
  React.useEffect(() => setDraft(value ?? ''), [value])

  switch (field.type) {
    case 'SELECT':
      return (
        <Select value={value ?? ''} onValueChange={(next) => onCommit(next === CLEAR ? null : next)} disabled={disabled}>
          <SelectTrigger id={id} className="h-9 w-full">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
            {value && <SelectItem value={CLEAR}>Clear</SelectItem>}
          </SelectContent>
        </Select>
      )
    case 'MULTI_SELECT': {
      const selected = new Set<string>(value ? (JSON.parse(value) as string[]) : [])
      return (
        <div id={id} className="flex flex-wrap gap-x-3 gap-y-1">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={selected.has(option)}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  const next = new Set(selected)
                  if (checked === true) next.add(option)
                  else next.delete(option)
                  onCommit([...next])
                }}
              />
              {option}
            </label>
          ))}
        </div>
      )
    }
    case 'CHECKBOX':
      return (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox id={id} checked={value === 'true'} disabled={disabled} onCheckedChange={(checked) => onCommit(checked === true)} />
          {value === 'true' ? 'Yes' : 'No'}
        </label>
      )
    case 'DATE':
      return (
        <DatePicker
          value={value ? new Date(`${value}T12:00:00Z`) : null}
          onChange={(date) => onCommit(date ? date.toISOString().slice(0, 10) : null)}
          disabled={disabled}
          placeholder="Not set"
        />
      )
    case 'USER':
      return <UserPicker users={members} value={value} onChange={(userId) => onCommit(userId)} disabled={disabled} />
    default:
      return (
        <Input
          id={id}
          type={field.type === 'NUMBER' ? 'number' : field.type === 'URL' ? 'url' : 'text'}
          inputMode={field.type === 'NUMBER' ? 'decimal' : undefined}
          value={draft}
          placeholder={field.type === 'URL' ? 'https://' : 'Not set'}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== (value ?? '') && onCommit(draft)}
          onKeyDown={(event) => event.key === 'Enter' && (event.currentTarget as HTMLInputElement).blur()}
          className="h-9"
        />
      )
  }
}
