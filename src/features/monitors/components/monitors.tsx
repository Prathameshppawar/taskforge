'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Activity, CircleAlert, CircleCheck, CircleHelp, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkMonitorNowAction, createMonitorAction, deleteMonitorAction } from '../actions'
import type { ProjectMonitors } from '../queries'

const STATE = {
  UP: { icon: CircleCheck, label: 'Up', className: 'text-emerald-600' },
  DOWN: { icon: CircleAlert, label: 'Down', className: 'text-destructive' },
  UNKNOWN: { icon: CircleHelp, label: 'Not checked yet', className: 'text-muted-foreground' },
} as const

/** Project settings: uptime monitors. State is always an icon and a word, never colour alone. */
export function Monitors({ projectId, monitors, canEdit }: { projectId: string; monitors: ProjectMonitors; canEdit: boolean }) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [keyword, setKeyword] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  function run<T>(work: () => Promise<{ success: true; data: T } | { success: false; error: string }>, done?: (data: T) => void) {
    startTransition(async () => {
      const result = await work()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      done?.(result.data)
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Activity className="size-4 text-muted-foreground" />
          Uptime monitors
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Checked every few minutes. Two failures in a row open an incident ticket by TaskForge Ops; recovery is posted to
          it with how long the outage lasted. Public addresses only.
        </p>
      </div>

      {monitors.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {monitors.map((monitor) => {
            const state = STATE[monitor.state]
            const Icon = state.icon
            return (
              <li key={monitor.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-xs">
                <span className={cn('flex items-center gap-1 font-medium', state.className)}>
                  <Icon className="size-3.5" /> {state.label}
                </span>
                <span className="font-medium">{monitor.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{monitor.url}</span>
                <span className="tabular-nums text-muted-foreground" title="Uptime over the last 24 hours and 7 days">
                  {monitor.uptime24h ?? '—'}% · {monitor.uptime7d ?? '—'}%
                </span>
                {monitor.lastLatencyMs != null && <span className="tabular-nums text-muted-foreground">{monitor.lastLatencyMs} ms</span>}
                {canEdit && (
                  <span className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Check ${monitor.name} now`} disabled={isPending}
                      onClick={() => run(() => checkMonitorNowAction({ projectId, monitorId: monitor.id }), (data) => toast.success(`${monitor.name} is ${data.state}.`))}>
                      <RefreshCw className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${monitor.name}`} disabled={isPending}
                      onClick={() => run(() => deleteMonitorAction({ projectId, monitorId: monitor.id }))}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                )}
                {monitor.lastError && <p className="basis-full text-destructive">{monitor.lastError}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/20 p-3">
          <div className="w-36 space-y-1">
            <Label htmlFor="monitor-name" className="text-xs">Name</Label>
            <Input id="monitor-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Website" className="h-8 text-xs" />
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="monitor-url" className="text-xs">URL</Label>
            <Input id="monitor-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/health" className="h-8 font-mono text-xs" />
          </div>
          <div className="w-36 space-y-1">
            <Label htmlFor="monitor-keyword" className="text-xs">Must contain <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="monitor-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="h-8 text-xs" />
          </div>
          <Button size="sm" className="h-8" disabled={isPending || !name.trim() || !url.trim()}
            onClick={() => run(() => createMonitorAction({ projectId, name, url, keyword: keyword || undefined }), (data) => {
              setName(''); setUrl(''); setKeyword('')
              toast.success(`Added. First check: ${data.state}.`)
            })}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add monitor
          </Button>
        </div>
      )}
    </section>
  )
}
