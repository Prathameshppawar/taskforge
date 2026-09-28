'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronDown,
  CircleCheck,
  CircleSlash,
  CircleX,
  ExternalLink,
  Loader2,
  Sparkles,
} from 'lucide-react'
import type { AiFixStatus } from '@prisma/client'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { startAiFixAction } from '../actions'
import type { AiFixPanelData } from '../queries'

const ACTIVE: ReadonlySet<AiFixStatus> = new Set<AiFixStatus>(['QUEUED', 'RUNNING'])

const STATUS: Record<AiFixStatus, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  QUEUED: { label: 'Queued', icon: Loader2, className: 'text-muted-foreground' },
  RUNNING: { label: 'Working', icon: Loader2, className: 'text-amber-600' },
  SUCCEEDED: { label: 'Pull request opened', icon: CircleCheck, className: 'text-emerald-600' },
  NO_CHANGES: { label: 'No changes made', icon: CircleSlash, className: 'text-muted-foreground' },
  FAILED: { label: 'Failed', icon: CircleX, className: 'text-destructive' },
}

/**
 * "Fix with AI".
 *
 * The result is always a pull request, never a merge — so the button's job is
 * to produce something for a person to review, and the panel's job is to show
 * exactly what the model did to get there.
 */
export function AiFixPanel({ ticketId, data }: { ticketId: string; data: AiFixPanelData }) {
  const router = useRouter()
  const [engine, setEngine] = React.useState<string>(data.engines[0]?.id ?? '')
  const [repoId, setRepoId] = React.useState(data.repos[0]?.id ?? '')
  const [instructions, setInstructions] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const running = data.runs.some((run) => ACTIVE.has(run.status))

  // Poll while a run is live; the run row is the only channel back.
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [running, router])

  if (data.repos.length === 0) return null

  const selected = data.engines.find((candidate) => candidate.id === engine)

  function start() {
    startTransition(async () => {
      const result = await startAiFixAction({
        ticketId,
        repoId,
        engine: engine as 'anthropic' | 'openai' | 'groq',
        instructions: instructions.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Started. The pull request will appear here and under Development.')
      setOpen(false)
      setInstructions('')
      router.refresh()
    })
  }

  return (
    <section className="space-y-2" aria-labelledby="ai-fix-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ai-fix-heading" className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" />
          Fix with AI
        </h2>
        {data.engines.length > 0 && !open && (
          <Button variant="outline" size="sm" className="h-7" disabled={running} onClick={() => setOpen(true)}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {running ? 'Working…' : 'Fix with AI'}
          </Button>
        )}
      </div>

      {data.engines.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No AI engine is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or GROQ_API_KEY on the
          server.
        </p>
      )}

      {open && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ai-engine" className="text-xs">Engine</Label>
              <Select value={engine} onValueChange={setEngine}>
                <SelectTrigger id="ai-engine" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.engines.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id} className="text-xs">
                      {candidate.label}
                      <span className="ml-1.5 font-mono text-muted-foreground">{candidate.model}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-repo" className="text-xs">Repository</Label>
              <Select value={repoId} onValueChange={setRepoId}>
                <SelectTrigger id="ai-repo" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.repos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id} className="font-mono text-xs">
                      {repo.fullName}
                      {repo.role ? ` · ${repo.role}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-instructions" className="text-xs">
              Extra guidance <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="ai-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Where to look, what not to touch, how it should behave…"
              className="min-h-16 text-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            The model reads the repository and stages a change; TaskForge opens it as a pull request
            on a new branch. It cannot run the code, and nothing is merged without a person.
            {selected?.id === 'groq' && ' Groq is best for small, contained fixes.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={start} disabled={isPending || !engine || !repoId}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Start
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {data.runs.length > 0 && (
        <ul className="divide-y rounded-md border">
          {data.runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}

function RunRow({ run }: { run: AiFixPanelData['runs'][number] }) {
  const [expanded, setExpanded] = React.useState(ACTIVE.has(run.status))
  const status = STATUS[run.status]
  const Icon = status.icon

  return (
    <li className="px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', status.className, ACTIVE.has(run.status) && 'animate-spin')} />
        <span className="font-medium">{status.label}</span>
        {run.prUrl && (
          <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            #{run.prNumber} <ExternalLink className="size-3" />
          </a>
        )}
        <span className="text-muted-foreground">
          {run.provider} · <span className="font-mono">{run.model}</span>
          {run.turns > 0 && ` · ${run.turns} turns`}
          {run.inputTokens + run.outputTokens > 0 &&
            ` · ${Math.round((run.inputTokens + run.outputTokens) / 100) / 10}k tokens`}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          {formatDistanceToNow(run.createdAt, { addSuffix: true })}
          <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {run.error && <p className="mt-1 text-destructive">{run.error}</p>}

      {expanded && (
        <div className="mt-2 space-y-2">
          {run.summary && <p className="whitespace-pre-wrap text-muted-foreground">{run.summary}</p>}
          {run.changedFiles && (
            <p className="font-mono text-[11px] text-muted-foreground">
              Changed: {run.changedFiles.split('\n').join(', ')}
            </p>
          )}
          {run.transcript && (
            <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
              {run.transcript}
            </pre>
          )}
          {run.requestedBy && (
            <p className="text-[11px] text-muted-foreground">Requested by {run.requestedBy.name}</p>
          )}
        </div>
      )}
    </li>
  )
}
