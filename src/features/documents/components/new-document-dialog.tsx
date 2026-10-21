'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MarkdownEditor } from '@/components/shared/markdown-editor'
import { DOCUMENT_LIMITS, SUGGESTED_DOCUMENTS } from '@/core/domain/project-documents'
import { saveProjectDocumentAction } from '../actions'

/** Starts a named document: a title, the usual names to pick from, and a first version. */
export function NewDocumentDialog({ projectId, existingKeys }: { projectId: string; existingKeys: string[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [pending, startTransition] = React.useTransition()
  const suggestions = SUGGESTED_DOCUMENTS.filter((suggestion) => !existingKeys.includes(suggestion.key))

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle('')
      setBody('')
    }
    setOpen(next)
  }

  function create() {
    const name = title.trim()
    startTransition(async () => {
      const result = await saveProjectDocumentAction({ projectId, title: name, body })
      if (!result.success) toast.error(result.error)
      else {
        toast.success(`Created ${name}.`)
        setOpen(false)
        router.push(`/projects/${projectId}/docs/${result.data.key}`)
      }
    })
  }

  return (
    <>
      <Button size="sm" onClick={() => handleOpenChange(true)}>
        <Plus className="size-4" /> New document
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="document-title">Title</Label>
              <Input
                id="document-title"
                value={title}
                maxLength={DOCUMENT_LIMITS.titleMax}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Functional flows"
                required
              />
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((suggestion) => (
                    <Button
                      key={suggestion.key}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setTitle(suggestion.title)}
                    >
                      {suggestion.title}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <MarkdownEditor value={body} onChange={setBody} rows={16} aria-label="Document body" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={create} disabled={pending || title.trim() === ''}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Create document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
