'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Triangle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveVercelTokenAction } from '../actions'

/** Workspace → Integrations: the Vercel token rollback needs. */
export function VercelCard({ status }: { status: { connected: boolean; hint: string | null; teamId: string | null } }) {
  const router = useRouter()
  const [token, setToken] = React.useState('')
  const [teamId, setTeamId] = React.useState(status.teamId ?? '')
  const [isPending, startTransition] = React.useTransition()

  function save(value: string | null) {
    startTransition(async () => {
      const result = await saveVercelTokenAction({ token: value, teamId: teamId || null })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(value ? `Connected as ${result.data.username}.` : 'Disconnected.')
      setToken('')
      router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Triangle className="size-5" />
        </span>
        <div className="space-y-1">
          <h2 className="font-semibold">Vercel {status.connected && <span className="text-xs font-normal text-muted-foreground">· token …{status.hint}</span>}</h2>
          <p className="text-sm text-muted-foreground">
            Deploys are already tracked through GitHub. A token adds one thing: <strong>rolling production back</strong> to the
            previous deploy from a ticket, in seconds, with Vercel&rsquo;s Instant Rollback.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="vercel-token" className="text-xs">
            Token{' '}
            <a href="https://vercel.com/account/settings/tokens" target="_blank" rel="noreferrer" className="text-primary hover:underline">create one</a>
          </Label>
          <Input id="vercel-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={status.connected ? 'Leave blank to keep the current token' : 'Paste a token'} className="h-8 font-mono text-xs" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vercel-team" className="text-xs">Team id <span className="text-muted-foreground">(if the project is in a team)</span></Label>
          <Input id="vercel-team" value={teamId} onChange={(event) => setTeamId(event.target.value)} placeholder="team_…" className="h-8 font-mono text-xs" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-8" disabled={isPending || !token.trim()} onClick={() => save(token.trim())}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Connect
          </Button>
          {status.connected && (
            <Button size="sm" variant="ghost" className="h-8" disabled={isPending} onClick={() => save(null)}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
