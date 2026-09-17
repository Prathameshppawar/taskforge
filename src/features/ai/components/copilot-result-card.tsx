'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  GitBranch,
  ListChecks,
  TrendingUp,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { PriorityBadge, StatusBadge } from '@/components/shared/badges'

/**
 * Structured rendering of what a tool actually did.
 *
 * Shown above the model's prose deliberately: these cards are the record of
 * real changes, and the user should be able to verify them without trusting the
 * narration.
 */

interface ToolResultShape {
  ok: boolean
  summary: string
  data?: unknown
}

export function CopilotResultCard({
  name,
  result,
}: {
  name: string
  result: ToolResultShape
}) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
        <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <span className="text-destructive">{result.summary}</span>
      </div>
    )
  }

  const data = result.data as Record<string, unknown> | undefined
  const kind = data?.kind as string | undefined

  switch (kind) {
    case 'ticket_created':
      return <CreatedCard data={data as never} />
    case 'bulk_created':
      return <BulkCard data={data as never} />
    case 'search':
      return <SearchCard data={data as never} />
    case 'ticket_updated':
      return <UpdatedCard data={data as never} />
    case 'insights':
      return <InsightsCard data={data as never} />
    case 'duplicates':
      return <DuplicatesCard data={data as never} />
    default:
      return null
  }
}

function CreatedCard({
  data,
}: {
  data: {
    key: string
    title: string
    projectName: string
    assignee: string | null
    warnings: string[]
  }
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-status-good">
        <CircleCheck className="size-3.5" />
        Ticket created
      </div>
      <Link
        href={`/tickets/${data.key}`}
        className="mt-1.5 block text-sm hover:underline"
      >
        <span className="font-mono text-xs text-muted-foreground">{data.key}</span>{' '}
        {data.title}
      </Link>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {data.projectName}
        {data.assignee && ` · assigned to ${data.assignee}`}
      </p>
      {data.warnings.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {data.warnings.join('; ')}
        </p>
      )}
    </div>
  )
}

function BulkCard({
  data,
}: {
  data: {
    parentKey: string
    parentTitle: string
    childKeys: string[]
    childTitles: string[]
    projectName: string
  }
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-status-good">
        <GitBranch className="size-3.5" />
        {data.childKeys.length + 1} tickets created
      </div>

      <Link
        href={`/tickets/${data.parentKey}`}
        className="mt-1.5 block text-sm font-medium hover:underline"
      >
        <span className="font-mono text-xs text-muted-foreground">{data.parentKey}</span>{' '}
        {data.parentTitle}
      </Link>

      <ul className="mt-1.5 space-y-0.5 border-l pl-3">
        {data.childKeys.map((key, index) => (
          <li key={key} className="text-xs">
            <Link href={`/tickets/${key}`} className="hover:underline">
              <span className="font-mono text-[10px] text-muted-foreground">{key}</span>{' '}
              {data.childTitles[index]}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SearchCard({
  data,
}: {
  data: {
    total: number
    tickets: Array<{
      id: string
      key: string
      title: string
      status: string
      statusColor: string
      priority: string
      priorityColor: string
      priorityLevel: number
      assignee: string | null
      projectCode: string
    }>
  }
}) {
  if (data.tickets.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-2.5 text-xs text-muted-foreground">
        No tickets matched.
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-1.5 border-b px-2.5 py-2 text-xs font-medium">
        <ListChecks className="size-3.5 text-muted-foreground" />
        {data.total} {data.total === 1 ? 'ticket' : 'tickets'}
        {data.total > data.tickets.length && (
          <span className="text-muted-foreground">
            (showing {data.tickets.length})
          </span>
        )}
      </div>

      <ul className="divide-y">
        {data.tickets.map((ticket) => (
          <li key={ticket.id} className="px-2.5 py-1.5">
            <Link href={`/tickets/${ticket.key}`} className="group block">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {ticket.key}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs group-hover:underline">
                  {ticket.title}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge name={ticket.status} color={ticket.statusColor} />
                <PriorityBadge
                  name={ticket.priority}
                  color={ticket.priorityColor}
                  level={ticket.priorityLevel}
                  showLabel={false}
                />
                <span className="text-[10px] text-muted-foreground">
                  {ticket.assignee ?? 'Unassigned'}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function UpdatedCard({
  data,
}: {
  data: { key: string; title: string; changes: string[] }
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-status-good">
        <CircleCheck className="size-3.5" />
        Ticket updated
      </div>
      <Link href={`/tickets/${data.key}`} className="mt-1.5 block text-sm hover:underline">
        <span className="font-mono text-xs text-muted-foreground">{data.key}</span>{' '}
        {data.title}
      </Link>
      {data.changes.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">{data.changes.join(' · ')}</p>
      )}
    </div>
  )
}

function InsightsCard({
  data,
}: {
  data: {
    projectName: string
    projectId: string
    percent: number
    stats: {
      total: number
      open: number
      inProgress: number
      blocked: number
      done: number
      overdue: number
    }
    workload: Array<{ userId: string; name: string; total: number; overdue: number }>
  }
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <TrendingUp className="size-3.5 text-muted-foreground" />
        {data.projectName}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Progress value={data.percent} className="h-1.5" />
        <span className="shrink-0 text-xs font-medium tabular-nums">{data.percent}%</span>
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Open" value={data.stats.open} />
        <Stat label="In progress" value={data.stats.inProgress} />
        <Stat label="Blocked" value={data.stats.blocked} emphasis={data.stats.blocked > 0} />
        <Stat label="Done" value={data.stats.done} />
        <Stat label="Overdue" value={data.stats.overdue} emphasis={data.stats.overdue > 0} />
        <Stat label="Total" value={data.stats.total} />
      </dl>

      <Link
        href={`/projects/${data.projectId}/insights`}
        className="mt-2 block text-[11px] text-primary hover:underline"
      >
        Open full dashboard →
      </Link>
    </div>
  )
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn('font-medium tabular-nums', emphasis && 'text-destructive')}
      >
        {value}
      </dd>
    </div>
  )
}

function DuplicatesCard({
  data,
}: {
  data: {
    matches: Array<{ id: string; key: string; title: string; statusName: string; score: number }>
  }
}) {
  if (data.matches.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-3.5" />
        {data.matches.length} possible {data.matches.length === 1 ? 'duplicate' : 'duplicates'}
      </div>
      <ul className="mt-1.5 space-y-1">
        {data.matches.map((match) => (
          <li key={match.id} className="text-xs">
            <Link href={`/tickets/${match.key}`} className="hover:underline">
              <span className="font-mono text-[10px] text-muted-foreground">{match.key}</span>{' '}
              {match.title}
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({match.statusName} · {Math.round(match.score * 100)}%)
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
