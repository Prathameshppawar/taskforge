'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/page-header'
import { createTokenAction, revokeTokenAction } from '../actions'

export interface TokenRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export function TokenManager({ tokens }: { tokens: TokenRow[] }) {
  const [creating, setCreating] = React.useState(false)
  const active = tokens.filter((t) => !t.revokedAt)

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setCreating(true)}>
        <Plus className="size-4" />
        New token
      </Button>

      {active.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No access tokens"
          description="Tokens let non-browser clients act as you — the MCP server, scripts, CI. They carry your permissions exactly, nothing more."
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {active.map((token) => (
            <TokenRowItem key={token.id} token={token} />
          ))}
        </ul>
      )}

      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function TokenRowItem({ token }: { token: TokenRow }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const expired = token.expiresAt !== null && token.expiresAt < new Date()

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{token.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {token.prefix}…
          </code>
          {expired && <Badge variant="outline">Expired</Badge>}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Created {token.createdAt.toLocaleDateString()}
          {token.lastUsedAt
            ? ` · last used ${token.lastUsedAt.toLocaleDateString()}`
            : ' · never used'}
          {token.expiresAt && ` · expires ${token.expiresAt.toLocaleDateString()}`}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="size-8 hover:text-destructive"
        disabled={isPending}
        aria-label={`Revoke ${token.name}`}
        onClick={() =>
          startTransition(async () => {
            const result = await revokeTokenAction(token.id)
            if (!result.success) {
              toast.error(result.error)
              return
            }
            toast.success('Token revoked.')
            router.refresh()
          })
        }
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>
    </li>
  )
}

function CreateTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [issued, setIssued] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (open) {
      setName('')
      setIssued(null)
      setCopied(false)
    }
  }, [open])

  function submit() {
    startTransition(async () => {
      const result = await createTokenAction({ name, expiresInDays: null })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setIssued(result.data.token)
      router.refresh()
    })
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{issued ? 'Token created' : 'New access token'}</DialogTitle>
          <DialogDescription>
            {issued
              ? 'Copy it now — this is the only time it is shown. Only a hash is stored, so it cannot be recovered.'
              : 'The token acts as you. It carries your permissions exactly, and every action it takes is recorded in the activity log under your name.'}
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{issued}</code>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label="Copy token"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued)
                    setCopied(true)
                    toast.success('Copied.')
                  } catch {
                    toast.error('Could not copy — select it and copy manually.')
                  }
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium">Use it with the MCP server</p>
              <pre className="mt-1.5 overflow-x-auto rounded bg-muted p-2 font-mono text-[10px] leading-relaxed">
{`TASKFORGE_URL=${origin}
TASKFORGE_TOKEN=${issued}
npm run mcp`}
              </pre>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Claude Desktop"
              autoFocus
              onKeyDown={(event) => event.key === 'Enter' && name.trim() && submit()}
            />
            <p className="text-[11px] text-muted-foreground">
              A label so you can identify it later. It does not affect access.
            </p>
          </div>
        )}

        <DialogFooter>
          {issued ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={isPending || !name.trim()}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Create token
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
