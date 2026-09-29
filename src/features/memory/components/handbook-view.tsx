'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { BookOpen, Download, Loader2, Pencil, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarkdownEditor } from '@/components/shared/markdown-editor'
import { RichText } from '@/components/shared/rich-text'
import { generateHandbookAction, markHandbookReadAction, saveHandbookAction } from '../actions'

export interface HandbookVersion {
  version: number
  title: string
  body: string
  source: string
  engine: string | null
  author: string | null
  createdAt: Date
}

const SOURCE_LABEL: Record<string, string> = { AI: 'Written by the Release Manager', FACTS: 'Assembled from the recorded facts', EDIT: 'Edited' }

/** The handbook, its versions, and — for managers — regenerate and edit. */
export function HandbookView({ projectId, versions, canManage }: { projectId: string; versions: HandbookVersion[]; canManage: boolean }) {
  const router = useRouter()
  const [selected, setSelected] = React.useState(versions[0]?.version ?? 0)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [pending, startTransition] = React.useTransition()
  const current = versions.find((entry) => entry.version === selected) ?? versions[0]

  React.useEffect(() => setSelected(versions[0]?.version ?? 0), [versions])
  React.useEffect(() => {
    if (versions[0]) void markHandbookReadAction({ projectId, version: versions[0].version })
  }, [projectId, versions])

  function generate() {
    startTransition(async () => {
      const result = await generateHandbookAction(projectId)
      if (!result.success) toast.error(result.error)
      else {
        toast.success(`Version ${result.data.version} ready${result.data.source === 'FACTS' ? ' — assembled from the facts, since no AI engine is connected' : ''}.`)
        router.refresh()
      }
    })
  }

  if (!current) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <BookOpen className="mx-auto size-7 text-muted-foreground" aria-hidden />
        <p className="mt-3 font-medium">No handbook yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          It is written from everything the project already records — its people, how work flows, the repositories’ READMEs and conventions, what has been finished and what needs attention — so a new member can start without a handover.
        </p>
        {canManage && (
          <Button className="mt-4" onClick={generate} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <BookOpen className="size-4" />}
            Write the handbook
          </Button>
        )}
      </div>
    )
  }

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
          {current.engine ? ` · ${current.engine}` : ''}
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
            <>
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
              <Button size="sm" variant="outline" className="h-8" onClick={generate} disabled={pending}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Regenerate
              </Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <MarkdownEditor value={draft} onChange={setDraft} rows={28} aria-label="Handbook" />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveHandbookAction({ projectId, body: draft })
                  if (!result.success) toast.error(result.error)
                  else {
                    toast.success(`Saved as version ${result.data.version}.`)
                    setEditing(false)
                    router.refresh()
                  }
                })
              }
            >
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
