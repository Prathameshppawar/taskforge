'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Check, Copy, Loader2, Send, Trash2, Webhook } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { createWebhookAction, deleteWebhookAction, retryJobsAction, setWebhookActiveAction, testWebhookAction } from '../actions'

const EVENTS = ['ticket.created', 'ticket.status_changed', 'ticket.completed', 'comment.created'] as const

export interface WebhookRow {
  id: string
  name: string
  url: string
  events: string[]
  project: string | null
  active: boolean
  lastStatus: number | null
  lastError: string | null
  lastDeliveredAt: Date | null
}

/** Workspace → Integrations: the public API and outbound webhooks. */
export function WebhooksCard({
  hooks,
  projects,
  jobs,
  apiBase,
}: {
  hooks: WebhookRow[]
  projects: Array<{ id: string; name: string }>
  jobs: { counts: Record<string, number>; failures: Array<{ id: string; kind: string; lastError: string | null }> }
  apiBase: string
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [events, setEvents] = React.useState<Set<string>>(new Set(['ticket.created', 'ticket.completed']))
  const [project, setProject] = React.useState('all')
  const [secret, setSecret] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  const run = (action: () => Promise<{ success: boolean; error?: string }>, done?: string) =>
    startTransition(async () => {
      const result = await action()
      if (!result.success) toast.error(result.error ?? 'That did not work.')
      else {
        if (done) toast.success(done)
        router.refresh()
      }
    })

  return (
    <section className="space-y-4 rounded-xl border p-4" aria-labelledby="webhooks-heading">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Webhook className="size-5" />
        </span>
        <div className="space-y-1">
          <h2 id="webhooks-heading" className="font-semibold">API and webhooks</h2>
          <p className="text-sm text-muted-foreground">
            The REST API is at <code className="rounded bg-muted px-1 text-xs">{apiBase}/api/v1</code> — authenticate with a personal access token (Settings → Access tokens); every call has that person’s permissions. Webhooks tell other systems when tickets change, signed with <code className="text-xs">X-TaskForge-Signature: sha256=…</code>.
          </p>
        </div>
      </div>

      {secret && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">Copy the signing secret now — it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{secret}</code>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() =>
                void navigator.clipboard.writeText(secret).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }
              aria-label="Copy the secret"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </div>
      )}

      {hooks.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex flex-wrap items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {hook.name} <span className="text-xs font-normal text-muted-foreground">· {hook.project ?? 'all projects'}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{hook.url}</p>
                <p className="text-[11px] text-muted-foreground">
                  {hook.events.join(', ')}
                  {hook.lastDeliveredAt && (
                    <>
                      {' '}· last {formatDistanceToNow(new Date(hook.lastDeliveredAt), { addSuffix: true })}:{' '}
                      <span className={hook.lastError ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}>{hook.lastError ?? `HTTP ${hook.lastStatus}`}</span>
                    </>
                  )}
                </p>
              </div>
              <Switch checked={hook.active} disabled={pending} onCheckedChange={(active) => run(() => setWebhookActiveAction({ id: hook.id, active }))} aria-label={`${hook.name} active`} />
              <Button size="sm" variant="ghost" className="h-7" disabled={pending} onClick={() => run(() => testWebhookAction(hook.id), 'Delivered.')}>
                <Send className="size-3.5" /> Test
              </Button>
              <Button size="icon" variant="ghost" className="size-7 hover:text-destructive" disabled={pending} onClick={() => run(() => deleteWebhookAction(hook.id))} aria-label={`Delete ${hook.name}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-sm font-medium">Add a webhook</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-name">Name</Label>
            <Input id="webhook-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Zapier, a Slack relay…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-project">Project</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="webhook-project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="webhook-url">URL</Label>
            <Input id="webhook-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={events.has(event)}
                onCheckedChange={(value) =>
                  setEvents((current) => {
                    const next = new Set(current)
                    if (value === true) next.add(event)
                    else next.delete(event)
                    return next
                  })
                }
              />
              {event}
            </label>
          ))}
        </div>
        <Button
          size="sm"
          disabled={pending || !name.trim() || !url.trim() || events.size === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await createWebhookAction({ name, url, events: [...events], projectId: project === 'all' ? null : project })
              if (!result.success) toast.error(result.error)
              else {
                setSecret(result.data.secret)
                setName('')
                setUrl('')
                router.refresh()
              }
            })
          }
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Add webhook
        </Button>
        <p className="text-[11px] text-muted-foreground">Delivered within about five minutes, retried with backoff for about eight hours. Private and local addresses are refused.</p>
      </div>

      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Background jobs: {jobs.counts.PENDING ?? 0} waiting, {jobs.counts.RUNNING ?? 0} running, {jobs.counts.FAILED ?? 0} failed.
        {(jobs.counts.FAILED ?? 0) > 0 && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={pending} onClick={() => run(retryJobsAction, 'Retrying.')}>
            Retry failed
          </Button>
        )}
      </p>
      {jobs.failures.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-destructive">
          {jobs.failures.slice(0, 5).map((failure) => (
            <li key={failure.id}>
              {failure.kind}: {failure.lastError}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
