'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import type { PickableUser } from '@/components/shared/user-picker'
import { setFieldValueAction } from '../field-actions'
import { FieldControl, type FieldView } from './field-control'

/** The project's own fields on a ticket, each saving as it changes. */
export function CustomFieldsPanel({
  ticketId,
  fields,
  values,
  members,
  canEdit,
}: {
  ticketId: string
  fields: FieldView[]
  values: Record<string, string>
  members: PickableUser[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [local, setLocal] = React.useState(values)
  const [pending, startTransition] = React.useTransition()
  React.useEffect(() => setLocal(values), [values])

  if (fields.length === 0) return null

  function commit(field: FieldView, value: unknown) {
    const previous = local
    startTransition(async () => {
      const result = await setFieldValueAction({ ticketId, fieldId: field.id, value })
      if (!result.success) {
        setLocal(previous)
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.id} className="space-y-1.5">
          <Label htmlFor={`field-${field.id}`} className="text-xs text-muted-foreground" title={field.description ?? undefined}>
            {field.name}
          </Label>
          <FieldControl
            id={`field-${field.id}`}
            field={field}
            value={local[field.id] ?? null}
            members={members}
            disabled={!canEdit || pending}
            onCommit={(value) => commit(field, value)}
          />
        </div>
      ))}
    </div>
  )
}
