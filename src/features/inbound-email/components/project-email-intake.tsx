'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { setProjectEmailIntakeAction } from '../actions'

/** Project settings: this project's email address, and whether it takes tickets. */
export function ProjectEmailIntake({
  projectId,
  address,
  enabled,
  workspaceEnabled,
  canEdit,
}: {
  projectId: string
  address: string | null
  enabled: boolean
  workspaceEnabled: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [copied, setCopied] = React.useState(false)

  return (
    <section className="space-y-3" aria-labelledby="email-intake-heading">
      <div>
        <h2 id="email-intake-heading" className="text-sm font-semibold">Tickets by email</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Anyone on this project can email a request — the subject becomes the title, attachments come along, and replies become comments.
        </p>
      </div>
      {!address ? (
        <p className="text-xs text-muted-foreground">Email is not configured for this workspace.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 pl-3">
            <code className="min-w-0 flex-1 truncate text-sm">{address}</code>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
              aria-label="Copy the address"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="email-intake">Take tickets by email</Label>
              {!workspaceEnabled && <p className="text-xs text-amber-700 dark:text-amber-400">Email in is off for the workspace — turn it on in Workspace → Integrations.</p>}
            </div>
            <Switch
              id="email-intake"
              checked={enabled}
              disabled={!canEdit || pending}
              onCheckedChange={(next) =>
                startTransition(async () => {
                  const result = await setProjectEmailIntakeAction({ projectId, enabled: next })
                  if (!result.success) toast.error(result.error)
                  else router.refresh()
                })
              }
            />
          </div>
        </>
      )}
    </section>
  )
}
