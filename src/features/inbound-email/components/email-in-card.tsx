'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, Mail, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { checkMailboxNowAction, updateInboundSettingAction } from '../actions'
import type { InboundOverview } from '../queries'

const OUTCOME_TONE: Record<string, string> = {
  CREATED: 'text-emerald-600 dark:text-emerald-400',
  COMMENTED: 'text-emerald-600 dark:text-emerald-400',
  REJECTED: 'text-destructive',
  FAILED: 'text-destructive',
  IGNORED: 'text-muted-foreground',
}

/** Workspace → Integrations: email in, and what the mailbox has read. */
export function EmailInCard({ overview }: { overview: InboundOverview }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const { setting } = overview
  const local = overview.mailbox?.split('@')[0]
  const domain = overview.mailbox?.split('@')[1]

  function save(next: { enabled: boolean; structureWithAi: boolean }) {
    startTransition(async () => {
      const result = await updateInboundSettingAction(next)
      if (!result.success) toast.error(result.error)
      else router.refresh()
    })
  }

  return (
    <section className="space-y-4 rounded-xl border p-4" aria-labelledby="email-in-heading">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Mail className="size-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="email-in-heading" className="font-semibold">Email in</h2>
          <p className="text-sm text-muted-foreground">
            People email tickets to{' '}
            <code className="rounded bg-muted px-1 text-xs">{local ? `${local}+code@${domain}` : 'mailbox+code@…'}</code> — the project’s code after the plus — and replying
            to any {`TaskForge`} email about a ticket comments on it. Senders must be authenticated (DMARC, DKIM or SPF) and have an account; they act with their own permissions.
          </p>
        </div>
      </div>

      {!overview.configured ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Needs the same mailbox TaskForge sends from: EMAIL_HOST, EMAIL_USER and EMAIL_PASS. For Gmail, IMAP is read with the same app password.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="email-in-enabled">Read the mailbox</Label>
              <p className="text-xs text-muted-foreground">Every five minutes. Only unread mail sent to a plus address is read; the rest of the inbox is never touched.</p>
            </div>
            <Switch id="email-in-enabled" checked={setting.enabled} disabled={pending} onCheckedChange={(enabled) => save({ enabled, structureWithAi: setting.structureWithAi })} />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="email-in-ai">Structure with the Copilot</Label>
              <p className="text-xs text-muted-foreground">Turn a new email into a title, a tidy description, type, priority and acceptance criteria. The original text is always kept underneath.</p>
            </div>
            <Switch
              id="email-in-ai"
              checked={setting.structureWithAi}
              disabled={pending}
              onCheckedChange={(structureWithAi) => save({ enabled: setting.enabled, structureWithAi })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {setting.lastPolledAt ? `Last read ${formatDistanceToNow(new Date(setting.lastPolledAt), { addSuffix: true })}` : 'Not read yet'}
            </span>
            {setting.lastError && <span className="text-destructive">· {setting.lastError}</span>}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs"
              disabled={pending || !setting.enabled}
              onClick={() =>
                startTransition(async () => {
                  const result = await checkMailboxNowAction()
                  if (!result.success) toast.error(result.error)
                  else {
                    const counts = Object.entries(result.data.outcomes).map(([key, value]) => `${value} ${key.toLowerCase()}`)
                    toast.success(result.data.skipped ?? (result.data.read ? `Read ${result.data.read}: ${counts.join(', ')}.` : 'Nothing new.'))
                    router.refresh()
                  }
                })
              }
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Check now
            </Button>
          </div>

          {overview.recent.length > 0 && (
            <ul className="divide-y rounded-lg border text-xs">
              {overview.recent.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 p-2">
                  <span className={cn('w-20 shrink-0 font-medium', OUTCOME_TONE[entry.outcome])}>{entry.outcome.toLowerCase()}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.subject || '(no subject)'} <span className="text-muted-foreground">· {entry.fromAddress}</span>
                  </span>
                  {entry.ticket && (
                    <Link href={`/tickets/${entry.ticket.key}`} className="font-mono text-primary hover:underline">
                      {entry.ticket.key}
                    </Link>
                  )}
                  {entry.reason && <span className="w-full pl-22 text-muted-foreground">{entry.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
