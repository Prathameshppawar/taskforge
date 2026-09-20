'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ListTree, Loader2, Sparkles, Tag, User, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { captureAction, confirmCaptureAction, type CaptureResult } from '../actions'

/**
 * Notes in, tickets out.
 *
 * The Copilot can already do this, but through a one-line chat box — which is
 * the wrong shape for pasting a meeting note or a stack trace, and gives the
 * model six tools to choose between when only one applies. This is the same
 * capability with room to paste, a prompt that does one job, and the breakdown
 * shown for approval before anything is written.
 */
export function CaptureDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectCode?: string
}) {
  const router = useRouter()
  const [text, setText] = React.useState('')
  const [result, setResult] = React.useState<CaptureResult | null>(null)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (open) return
    // Cleared on close so the next capture does not open onto the last one.
    setText('')
    setResult(null)
  }, [open])

  function extract() {
    startTransition(async () => {
      const response = await captureAction({ text, projectId, projectCode })
      if (!response.success) {
        toast.error(response.error)
        return
      }
      setResult(response.data)
    })
  }

  function create() {
    if (!result) return
    startTransition(async () => {
      const response = await confirmCaptureAction({
        rawArguments: result.rawArguments,
        projectId,
      })
      if (!response.success) {
        toast.error(response.error)
        return
      }
      toast.success(response.data.summary)
      onOpenChange(false)
      router.refresh()
    })
  }

  const childCount = result?.breakdown.children.length ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" />
            {result ? 'Review the breakdown' : 'Capture notes as tickets'}
          </DialogTitle>
          <DialogDescription>
            {result
              ? 'Nothing has been written yet. Create these, or go back and adjust the notes.'
              : 'Paste a meeting note, a chat thread, an email or a stack trace. It becomes one parent ticket with its tasks underneath.'}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="px-5 py-4">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={isPending}
              placeholder={
                'e.g.\n\nCalled Regency this morning. The tablet app keeps losing sync when the\nvan goes out of coverage — Prakhar to look at the retry queue. They also\nwant the delivery note PDF to show the batch number. Harsh will update\nthe CMS copy for the new product page before Friday.'
              }
              className="min-h-52 resize-y text-sm"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {text.trim().length} characters · nothing is created until you approve it
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[55dvh]">
            <div className="px-5 py-4">
              <div className="overflow-hidden rounded-md border bg-background">
                <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1.5">
                  <ListTree className="size-3.5 shrink-0 text-primary" />
                  <span className="text-[11px] font-semibold tracking-wide uppercase">
                    1 parent + {childCount} {childCount === 1 ? 'task' : 'tasks'}
                  </span>
                  {projectCode && (
                    <span className="ml-auto rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {projectCode}
                    </span>
                  )}
                </div>

                <div className="px-2.5 pt-2 pb-1.5">
                  <p className="text-sm leading-snug font-medium">
                    {result.breakdown.parentTitle}
                  </p>
                  {result.breakdown.parentDescription && (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {result.breakdown.parentDescription}
                    </p>
                  )}
                </div>

                <ol className="border-t">
                  {result.breakdown.children.map((child, index) => (
                    <li key={index} className="flex gap-2 border-b px-2.5 py-2 last:border-b-0">
                      <span className="w-4 shrink-0 pt-px text-right font-mono text-[10px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-snug">{child.title}</p>
                        {child.description && (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                            {child.description}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {child.assignee && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <User className="size-2.5" />
                              {child.assignee}
                            </span>
                          )}
                          {child.labels?.map((label) => (
                            <span
                              key={label}
                              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                            >
                              <Tag className="size-2.5" />
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="border-t px-5 py-3">
          {result ? (
            <>
              <Button variant="ghost" onClick={() => setResult(null)} disabled={isPending}>
                <ArrowLeft className="size-4" />
                Back to notes
              </Button>
              <Button onClick={create} disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  `Create ${childCount + 1} tickets`
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={extract} disabled={isPending || text.trim().length < 20}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Reading…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Break it down
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
