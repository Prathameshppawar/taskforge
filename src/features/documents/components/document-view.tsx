'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Download, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarkdownEditor } from '@/components/shared/markdown-editor'
import { RichText } from '@/components/shared/rich-text'
import { DOCUMENT_SOURCE_LABELS as SOURCE_LABEL } from '@/core/domain/project-documents'
import { saveProjectDocumentAction } from '../actions'
import type { DocumentVersion } from '../queries'


/** A named document, its versions, and — for managers — edit as a new version. */
export function DocumentView({
  projectId,
  docKey,
  versions,
  canManage,
}: {
  projectId: string
  docKey: string
  versions: DocumentVersion[]
  canManage: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = React.useState(versions[0]?.version ?? 0)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [pending, startTransition] = React.useTransition()
  const current = versions.find((entry) => entry.version === selected) ?? versions[0]

  React.useEffect(() => setSelected(versions[0]?.version ?? 0), [versions])

  if (!current) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(current.version)} onValueChange={(value) => setSelected(Number(value))}>
          <SelectTrigger className="h-8 w-auto min-w-48" aria-label="Version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((entry) => (
              <SelectItem key={entry.version} value={String(entry.version)}>
                Version {entry.version} · {format(new Date(entry.createdAt), 'd MMM yyyy')}
                {entry.version === versions[0].version ? ' (latest)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {SOURCE_LABEL[current.source] ?? current.source}
          {current.author ? ` by ${current.author}` : ''}
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              const blob = new Blob([current.body], { type: 'text/markdown' })
              const link = document.createElement('a')
              link.href = URL.createObjectURL(blob)
              link.download = `${current.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${current.version}.md`
              link.click()
              URL.revokeObjectURL(link.href)
            }}
          >
            <Download className="size-3.5" /> .md
          </Button>
          {canManage && !editing && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                setDraft(current.body)
                setEditing(true)
              }}
            >
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <MarkdownEditor value={draft} onChange={setDraft} rows={28} aria-label={current.title} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveProjectDocumentAction({ projectId, key: docKey, body: draft })
                  if (!result.success) toast.error(result.error)
                  else {
                    toast.success(`Saved as version ${result.data.version}.`)
                    setEditing(false)
                    router.refresh()
                  }
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save as a new version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <article className="rounded-xl border bg-card p-5 sm:p-8">
          <RichText content={current.body} className="text-[15px]" />
        </article>
      )}
    </div>
  )
}
