'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Siren } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { rotateErrorIngestAction } from '../actions'

/** Project settings: the URL production errors are sent to. */
export function ErrorIntake({
  projectId,
  configured,
  canEdit,
  origin,
}: {
  projectId: string
  configured: boolean
  canEdit: boolean
  origin: string
}) {
  const router = useRouter()
  const [token, setToken] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const url = token ? `${origin}/api/ingest/errors/${token}` : null

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Siren className="size-4 text-muted-foreground" />
          Production errors
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Errors sent here become Production tickets, filed by TaskForge Triage with the stack trace and the changes most
          likely to blame. Repeats are counted, not refiled; an error that returns after its ticket is closed reopens it.
        </p>
      </div>

      {url ? (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium">Copy this now — it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1">{url}</code>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={async () => {
                await navigator.clipboard.writeText(url)
                setCopied(true)
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="text-muted-foreground">
            <strong>Sentry:</strong> Settings → Integrations → Webhooks (or an internal integration), paste it as the
            webhook URL, and add it to an issue alert rule. <strong>Anything else:</strong>{' '}
            <code>curl -X POST -H &apos;Content-Type: application/json&apos; -d &apos;{`{"message":"…","stack":"…","environment":"production"}`}&apos; &lt;url&gt;</code>
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {configured ? 'An intake URL is active.' : 'No intake URL yet.'}
        </p>
      )}

      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await rotateErrorIngestAction(projectId)
              if (!result.success) {
                toast.error(result.error)
                return
              }
              setToken(result.data.token)
              setCopied(false)
              router.refresh()
            })
          }
        >
          {configured ? 'Issue a new URL (the old one stops working)' : 'Create an intake URL'}
        </Button>
      )}
    </section>
  )
}
