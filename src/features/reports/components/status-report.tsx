'use client'

import * as React from 'react'
import { Check, Copy, FileText, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { generateStatusReportAction, type StatusReport } from '../actions'

/**
 * The weekly update, written from counted facts.
 *
 * The facts it was written from are shown underneath on purpose. A generated
 * paragraph nobody can check against its source is one nobody should paste into
 * an email to a client — and the check has to be one glance, not a second
 * screen.
 */
export function StatusReportCard({ projectId }: { projectId: string }) {
  const [report, setReport] = React.useState<StatusReport | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function generate() {
    startTransition(async () => {
      const result = await generateStatusReportAction(projectId, 7)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setReport(result.data)
      setCopied(false)
    })
  }

  const counts = report
    ? [
        ['completed', report.facts.completed.length],
        ['in flight', report.facts.started.length],
        ['raised', report.facts.created.length],
        ['overdue', report.facts.overdue.length],
        ['blocked', report.facts.blocked.length],
        ['stalled', report.facts.stalled.length],
      ].filter(([, count]) => (count as number) > 0)
    : []

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="size-4 text-muted-foreground" />
            Weekly update
          </h2>
          <p className="text-xs text-muted-foreground">
            Written from the last seven days, ready to send.
          </p>
        </div>

        <div className="flex gap-1.5">
          {report && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(report.prose)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                } catch {
                  toast.error('Could not copy. Select the text and copy it manually.')
                }
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              <span className="text-xs">{copied ? 'Copied' : 'Copy'}</span>
            </Button>
          )}
          <Button size="sm" className="h-8" onClick={generate} disabled={isPending}>
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : report ? (
              <RefreshCw className="size-3.5" />
            ) : null}
            <span className="text-xs">{report ? 'Regenerate' : 'Write it'}</span>
          </Button>
        </div>
      </div>

      {report && (
        <>
          <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
            {report.prose.split('\n').filter(Boolean).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          {counts.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Written from: {counts.map(([label, count]) => `${count} ${label}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
