'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { CustomFieldType } from '@prisma/client'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { deleteCustomFieldAction, upsertCustomFieldAction } from '@/features/tickets/field-actions'

export interface FieldRow {
  id: string
  name: string
  type: CustomFieldType
  description: string | null
  options: string[]
  required: boolean
  valueCount: number
}

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  SELECT: 'One choice',
  MULTI_SELECT: 'Several choices',
  DATE: 'Date',
  CHECKBOX: 'Yes / no',
  URL: 'Link',
  USER: 'Person',
}

/** Settings → Fields: what this project records about a ticket beyond the basics. */
export function CustomFieldsConfig({ projectId, fields, canEdit }: { projectId: string; fields: FieldRow[]; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<FieldRow | 'new' | null>(null)
  const [busy, startTransition] = React.useTransition()

  return (
    <section className="space-y-3" aria-labelledby="fields-heading">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="fields-heading" className="text-sm font-semibold">Fields</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What this project records on every ticket beyond the basics — environment, customer, browser. Agents read them too.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add
          </Button>
        )}
      </div>

      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">No fields yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {fields.map((field) => (
            <li key={field.id} className="group flex items-center gap-3 p-2.5 text-sm">
              <span className="font-medium">{field.name}</span>
              <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[field.type]}</Badge>
              {field.required && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
              {field.options.length > 0 && (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{field.options.join(' · ')}</span>
              )}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{field.valueCount}</span>
              {canEdit && (
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(field)} aria-label={`Edit ${field.name}`}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 hover:text-destructive"
                    disabled={busy}
                    aria-label={`Delete ${field.name}`}
                    onClick={() => {
                      if (!window.confirm(`Delete ${field.name}? Its value on ${field.valueCount} tickets is removed.`)) return
                      startTransition(async () => {
                        const result = await deleteCustomFieldAction({ projectId, id: field.id })
                        if (!result.success) toast.error(result.error)
                        else router.refresh()
                      })
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <FieldDialog projectId={projectId} value={editing} onClose={() => setEditing(null)} />
    </section>
  )
}

function FieldDialog({ projectId, value, onClose }: { projectId: string; value: FieldRow | 'new' | null; onClose: () => void }) {
  const router = useRouter()
  const existing = value && value !== 'new' ? value : null
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<CustomFieldType>('TEXT')
  const [description, setDescription] = React.useState('')
  const [options, setOptions] = React.useState('')
  const [required, setRequired] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!value) return
    setName(existing?.name ?? '')
    setType(existing?.type ?? 'TEXT')
    setDescription(existing?.description ?? '')
    setOptions((existing?.options ?? []).join('\n'))
    setRequired(existing?.required ?? false)
  }, [value, existing])

  const choices = type === 'SELECT' || type === 'MULTI_SELECT'

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'New field'}</DialogTitle>
          <DialogDescription>Every ticket in this project gets it, in the sidebar and when it is created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="field-name">Name</Label>
            <Input id="field-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Environment" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="field-type">Type</Label>
            <Select value={type} onValueChange={(next) => setType(next as CustomFieldType)} disabled={Boolean(existing)}>
              <SelectTrigger id="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {TYPE_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {existing && <p className="text-[11px] text-muted-foreground">A field’s type is fixed once it exists, so no stored value is reinterpreted.</p>}
          </div>
          {choices && (
            <div className="space-y-1.5">
              <Label htmlFor="field-options">Options</Label>
              <Textarea id="field-options" value={options} onChange={(event) => setOptions(event.target.value)} rows={4} placeholder={'Production\nStaging\nLocal'} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="field-description">Help text</Label>
            <Input id="field-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="field-required">Required when creating a ticket</Label>
              <p className="text-xs text-muted-foreground">Asked for in the new-ticket dialog. Email and the Copilot can still create tickets without it.</p>
            </div>
            <Switch id="field-required" checked={required} onCheckedChange={setRequired} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await upsertCustomFieldAction({
                  id: existing?.id,
                  projectId,
                  name,
                  type,
                  description: description || null,
                  options,
                  required,
                })
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                toast.success(existing ? 'Saved.' : `${name} added to every ticket.`)
                onClose()
                router.refresh()
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {existing ? 'Save' : 'Add field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
