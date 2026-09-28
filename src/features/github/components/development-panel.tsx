'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import type { GitCheckState, GitRefKind, GitRefState } from '@prisma/client'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { syncProjectReposAction } from '../actions'
import type { TicketDevelopment } from '../queries'

const KIND_LABEL: Record<GitRefKind, string> = {
  PULL_REQUEST: 'Pull requests',
  BRANCH: 'Branches',
  COMMIT: 'Commits',
}

const STATE_STYLE: Record<GitRefState, { label: string; className: string }> = {
  OPEN: { label: 'Open', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  MERGED: { label: 'Merged', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-400' },
  CLOSED: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
}

function RefIcon({ kind, state }: { kind: GitRefKind; state: GitRefState | null }) {
  const className = 'size-3.5 shrink-0'
  if (kind === 'COMMIT') return <GitCommitHorizontal className={cn(className, 'text-muted-foreground')} />
  if (kind === 'BRANCH') {
    return <GitBranch className={cn(className, state === 'CLOSED' ? 'text-muted-foreground' : 'text-emerald-600')} />
  }
  switch (state) {
    case 'MERGED':
      return <GitMerge className={cn(className, 'text-violet-600')} />
    case 'CLOSED':
      return <GitPullRequestClosed className={cn(className, 'text-muted-foreground')} />
    case 'DRAFT':
      return <GitPullRequestDraft className={cn(className, 'text-muted-foreground')} />
    default:
      return <GitPullRequest className={cn(className, 'text-emerald-600')} />
  }
}

function Checks({ state }: { state: GitCheckState | null }) {
  if (!state) return null
  if (state === 'SUCCESS') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600" title="Checks passed">
        <CircleCheck className="size-3" /> checks
      </span>
    )
  }
  if (state === 'FAILURE') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive" title="Checks failed">
        <CircleX className="size-3" /> checks
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600" title="Checks running">
      <CircleDashed className="size-3 animate-spin [animation-duration:3s]" /> checks
    </span>
  )
}

/**
 * Where the code for this ticket is.
 *
 * Nothing here is entered by hand: every row arrived because a branch, pull
 * request or commit mentioned the ticket's key. The suggested branch name is
 * what makes that happen for the next piece of work, so it is the first thing
 * offered when nothing is linked yet.
 */
export function DevelopmentPanel({
  projectId,
  development,
  canSync,
}: {
  projectId: string
  development: TicketDevelopment
  canSync: boolean
}) {
  const router = useRouter()
  const [copied, setCopied] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const { refs, hasRepos, branchName } = development

  if (!hasRepos && refs.length === 0) return null

  const groups = (['PULL_REQUEST', 'BRANCH', 'COMMIT'] as const)
    .map((kind) => [kind, refs.filter((ref) => ref.kind === kind)] as const)
    .filter(([, rows]) => rows.length > 0)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`git checkout -b ${branchName}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not reach the clipboard.')
    }
  }

  return (
    <section className="space-y-2" aria-labelledby="development-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="development-heading" className="flex items-center gap-1.5 text-sm font-medium">
          <GitPullRequest className="size-4 text-muted-foreground" />
          Development
        </h2>
        {canSync && hasRepos && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await syncProjectReposAction(projectId)
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                router.refresh()
              })
            }
          >
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Sync
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 truncate text-[11px]">git checkout -b {branchName}</code>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 shrink-0 p-0"
          onClick={copy}
          aria-label="Copy branch command"
        >
          {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing yet. Any branch, pull request or commit that mentions this ticket&rsquo;s key
          will show up here.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map(([kind, rows]) => (
            <div key={kind}>
              <p className="pb-0.5 text-[11px] text-muted-foreground">{KIND_LABEL[kind]}</p>
              <ul className="divide-y rounded-md border">
                {rows.map((ref) => (
                  <li key={ref.id} className="flex items-center gap-2 px-2.5 py-1.5">
                    <RefIcon kind={ref.kind} state={ref.state} />
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-xs hover:underline"
                      title={ref.title}
                    >
                      {ref.kind === 'PULL_REQUEST' && (
                        <span className="mr-1 font-mono text-muted-foreground">#{ref.externalId}</span>
                      )}
                      {ref.kind === 'COMMIT' && (
                        <span className="mr-1 font-mono text-muted-foreground">
                          {ref.externalId.slice(0, 7)}
                        </span>
                      )}
                      {ref.kind === 'BRANCH' ? <span className="font-mono">{ref.title}</span> : ref.title}
                    </a>
                    <Checks state={ref.checkState} />
                    {ref.state && ref.kind === 'PULL_REQUEST' && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-px text-[10px] font-medium',
                          STATE_STYLE[ref.state].className,
                        )}
                      >
                        {STATE_STYLE[ref.state].label}
                      </span>
                    )}
                    {ref.kind === 'BRANCH' && ref.state === 'CLOSED' && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">deleted</span>
                    )}
                    <span
                      className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline"
                      title={ref.repo.fullName}
                    >
                      {ref.repo.fullName.split('/')[1]} ·{' '}
                      {formatDistanceToNow(ref.updatedAt, { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
