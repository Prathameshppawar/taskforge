'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Download, Loader2, MessagesSquare } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { disconnectTeamsAction, saveTeamsAction } from '../actions'

/** Workspace → Integrations: the Microsoft Teams bot. */
export function TeamsCard({
  status,
  endpoint,
  channels,
}: {
  status: { connected: false } | { connected: true; appId: string; tenantId: string | null; hint: string }
  endpoint: string
  channels: Array<{ name: string | null; project: string | null }>
}) {
  const router = useRouter()
  const [appId, setAppId] = React.useState(status.connected ? status.appId : '')
  const [tenantId, setTenantId] = React.useState(status.connected ? (status.tenantId ?? '') : '')
  const [password, setPassword] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  return (
    <section className="space-y-4 rounded-xl border p-4" aria-labelledby="teams-heading">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <MessagesSquare className="size-5" />
        </span>
        <div className="space-y-1">
          <h2 id="teams-heading" className="font-semibold">
            Microsoft Teams {status.connected && <span className="text-xs font-normal text-muted-foreground">· secret …{status.hint}</span>}
          </h2>
          <p className="text-sm text-muted-foreground">
            A bot people write to in a chat or a project’s channel. It asks what is missing, keeps a draft ticket everyone in the thread can shape, and files it when someone presses Create — as them, with their permissions. A linked channel also hears about the project’s new tickets.
          </p>
        </div>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          In the <a className="text-primary hover:underline" href="https://dev.teams.microsoft.com/bots" target="_blank" rel="noreferrer">Teams Developer Portal</a>, open <em>Tools → Bot management</em>, create a bot, and set its endpoint to the address below. It is free, and needs no Azure subscription.
        </li>
        <li>Under <em>Client secrets</em>, add one. Paste the bot’s ID, the secret and your Microsoft 365 tenant ID here.</li>
        <li>Download the app package and upload it in Teams: <em>Apps → Manage your apps → Upload an app</em>.</li>
        <li>Chat with it, or add it to a team and write <code>@TaskForge link CODE</code> in a channel.</li>
      </ol>

      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 pl-3">
        <code className="min-w-0 flex-1 truncate text-sm">{endpoint}</code>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          aria-label="Copy the messaging endpoint"
          onClick={() =>
            void navigator.clipboard.writeText(endpoint).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="teams-app-id">Bot (app) ID</Label>
          <Input id="teams-app-id" value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="teams-tenant">Tenant ID</Label>
          <Input id="teams-tenant" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Directory (tenant) ID" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="teams-secret">Client secret</Label>
          <Input
            id="teams-secret"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={status.connected ? 'Leave empty to keep the current secret' : 'Stored encrypted; never shown again'}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || !appId.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await saveTeamsAction({ appId, password: password || undefined, tenantId })
              if (!result.success) toast.error(result.error)
              else {
                toast.success('Connected — Microsoft accepted the credentials.')
                setPassword('')
                router.refresh()
              }
            })
          }
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {status.connected ? 'Save' : 'Connect'}
        </Button>
        {status.connected && (
          <>
            <Button asChild size="sm" variant="outline">
              <a href="/api/msteams/app-package">
                <Download className="size-3.5" /> App package
              </a>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await disconnectTeamsAction()
                  if (!result.success) toast.error(result.error)
                  else router.refresh()
                })
              }
            >
              Disconnect
            </Button>
          </>
        )}
      </div>

      {channels.length > 0 && (
        <ul className="divide-y rounded-lg border text-xs">
          {channels.map((channel, index) => (
            <li key={index} className="flex justify-between gap-2 p-2">
              <span>{channel.name ?? 'A channel'}</span>
              <span className="text-muted-foreground">{channel.project ?? 'not linked'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
