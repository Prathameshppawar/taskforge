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
import { healPullRequestAction, startAiFixAction, startScaffoldAction } from '../actions'
import { reviewPullRequestAction } from '@/features/ai-review/actions'
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
export function AiFixPanel({
  ticketId,
  data,
  canScaffold = false,
  suggestedRepoName = '',
}: {
  ticketId: string
  data: AiFixPanelData
  canScaffold?: boolean
  suggestedRepoName?: string
}) {
  const router = useRouter()
  const [engine, setEngine] = React.useState<string>(data.engines[0]?.id ?? '')
  const [repoId, setRepoId] = React.useState(data.repos[0]?.id ?? '')
  const [instructions, setInstructions] = React.useState('')
  const [mode, setMode] = React.useState<'FIX' | 'PLAN'>('FIX')
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const running = data.runs.some((run) => ACTIVE.has(run.status))

  // Poll while a run is live; the run row is the only channel back.
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [running, router])

  // A project with no repository yet can still start one.
  if (data.repos.length === 0 && !(canScaffold && data.owners.length > 0)) return null

  const selected = data.engines.find((candidate) => candidate.id === engine)

  const engineId = engine

  function launch(work: () => Promise<{ success: true; data: unknown } | { success: false; error: string }>, message: string) {
    startTransition(async () => {
      const result = await work()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(message)
      setOpen(false)
      setInstructions('')
      router.refresh()
    })
  }

  function start() {
    startTransition(async () => {
      const result = await startAiFixAction({
        ticketId,
        repoId,
        engine: engineId,
        mode,
        instructions: instructions.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        mode === 'PLAN'
          ? 'Planning. The plan will be posted as a comment for you to approve.'
          : 'Started. The pull request will appear here and under Development.',
      )
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
                  {data.repos.length > 1 && mode === 'FIX' && (
                    <SelectItem value="ALL" className="text-xs">
                      All {data.repos.length} linked repositories
                    </SelectItem>
                  )}
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
          <div className="flex gap-1 rounded-md border bg-background p-0.5 text-xs">
            {(
              [
                ['FIX', 'Write the fix', 'Opens a pull request.'],
                ['PLAN', 'Plan first', 'Posts a plan to approve; changes nothing.'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'flex-1 rounded px-2 py-1 text-left',
                  mode === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                <span className="font-medium">{label}</span>
                <span className={cn('block text-[10px]', mode === value ? 'opacity-80' : 'text-muted-foreground')}>{hint}</span>
              </button>
            ))}
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

      {canScaffold && data.engines.length > 0 && data.owners.length > 0 && (
        <NewRepository ticketId={ticketId} data={data} engine={engineId} suggestedName={suggestedRepoName} />
      )}

      {data.failing.length > 0 && data.engines.length > 0 && (
        <ul className="divide-y rounded-md border border-destructive/40">
          {data.failing.map((ref) => (
            <li key={ref.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
              <span className="text-destructive">Checks failing</span>
              <span className="min-w-0 flex-1 truncate">
                #{ref.externalId} {ref.title}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={running || isPending}
                onClick={() =>
                  launch(
                    () => healPullRequestAction({ ticketId, refId: ref.id, engine: engineId }),
                    `The Coder is reading #${ref.externalId}'s failures.`,
                  )
                }
              >
                Fix failing checks
              </Button>
            </li>
          ))}
        </ul>
      )}

      {data.openPrs.length > 0 && data.engines.length > 0 && (
        <ul className="divide-y rounded-md border">
          {data.openPrs.map((ref) => (
            <li key={ref.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Open</span>
              <span className="min-w-0 flex-1 truncate">
                #{ref.externalId} {ref.title}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await reviewPullRequestAction({ ticketId, refId: ref.id, engine: engineId })
                    if (!result.success) {
                      toast.error(result.error)
                      return
                    }
                    toast.success(
                      `Reviewed #${ref.externalId}: ${result.data.inline + result.data.general} comments posted on GitHub.`,
                    )
                    router.refresh()
                  })
                }
              >
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                AI review
              </Button>
            </li>
          ))}
        </ul>
      )}

      {data.runs.length > 0 && (
        <ul className="divide-y rounded-md border">
          {data.runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onBuild={
                run.mode === 'PLAN' && run.status === 'SUCCEEDED' && !running
                  ? () =>
                      launch(
                        () => startAiFixAction({ ticketId, repoId, engine: engineId, mode: 'FIX', planRunId: run.id }),
                        'Building the approved plan.',
                      )
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Start a brand-new repository for this ticket: created as the person asking,
 * linked to the project, and scaffolded by the Coder from everything on the
 * ticket as a first pull request.
 */
function NewRepository({
  ticketId,
  data,
  engine,
  suggestedName,
}: {
  ticketId: string
  data: AiFixPanelData
  engine: string
  suggestedName: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(data.repos.length === 0)
  const owners = [...new Map([...(data.github ? [{ login: data.github.login, type: 'User' }] : []), ...data.owners].map((o) => [o.login, o])).values()]
  const [owner, setOwner] = React.useState(owners[0]?.login ?? '')
  const [name, setName] = React.useState(suggestedName)
  const [isPrivate, setIsPrivate] = React.useState(true)
  const [isPending, startTransition] = React.useTransition()

  if (!data.github) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        To start a new repository from this ticket,{' '}
        <a href="/settings/github" className="font-medium text-primary hover:underline">connect your GitHub account</a>.
      </p>
    )
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(true)}>
        Start a new repository from this ticket
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
      <p className="font-medium">New repository</p>
      <p className="text-muted-foreground">
        Created as {data.github.login}, linked to this project, then built by the Coder from the ticket — its description,
        conversation, attachments and resources — as a first pull request.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Owner</Label>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {owners.map((entry) => (
                <SelectItem key={entry.login} value={entry.login} className="text-xs">{entry.login}{entry.type === 'Organization' ? ' (org)' : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <Label className="text-xs">Name</Label>
          <input value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs" />
        </div>
        <label className="flex items-center gap-1 pb-2">
          <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} /> Private
        </label>
        <Button
          size="sm"
          className="h-8"
          disabled={isPending || !name.trim() || !owner}
          onClick={() =>
            startTransition(async () => {
              const result = await startScaffoldAction({ ticketId, owner, name: name.trim(), isPrivate, engine })
              if (!result.success) {
                toast.error(result.error)
                return
              }
              toast.success(`Created ${result.data.repo}. The Coder is building its first version.`)
              setOpen(false)
              router.refresh()
            })
          }
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Create and scaffold
        </Button>
      </div>
    </div>
  )
}

const MODE_LABEL = { FIX: 'Fix', PLAN: 'Plan', HEAL_CI: 'Heal CI', SCAFFOLD: 'New repo' } as const

function RunRow({ run, onBuild }: { run: AiFixPanelData['runs'][number]; onBuild?: () => void }) {
  const [expanded, setExpanded] = React.useState(ACTIVE.has(run.status))
  const status = STATUS[run.status]
  const Icon = status.icon

  return (
    <li className="px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', status.className, ACTIVE.has(run.status) && 'animate-spin')} />
        <span className="rounded bg-muted px-1 text-[10px]">
          {MODE_LABEL[run.mode]}
          {run.targetPrNumber ? ` #${run.targetPrNumber}` : ''}
        </span>
        <span className="font-medium">
          {run.mode === 'PLAN' && run.status === 'SUCCEEDED' ? 'Plan posted' : status.label}
        </span>
        {onBuild && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={onBuild}>
            Build this plan
          </Button>
        )}
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
