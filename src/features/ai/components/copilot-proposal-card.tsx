'use client'

import * as React from 'react'
import { format } from 'date-fns'
import {
  ArrowRight,
  CalendarClock,
  FolderGit2,
  GitBranch,
  ListTree,
  Pencil,
  Plus,
  Tag,
  User,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CopilotProposal } from './copilot-panel'

/**
 * What a pending write will actually do.
 *
 * The Copilot proposes changes rather than making them, and an approval is only
 * meaningful if the person can see what they are approving. A one-line summary
 * — "create a ticket" — asks them to trust the narration, which is precisely
 * what the propose-then-confirm step exists to avoid.
 *
 * Values are shown exactly as the model supplied them. Names like "High" are
 * resolved against the workspace on approval, so dressing them up as real
 * status or priority badges here would imply a match that has not happened yet.
 */

/** Mirrors the executor's bound, so the card cannot promise a date it will not get. */
const MAX_DUE_DAYS = 3650

export function CopilotProposalCard({ proposal }: { proposal: CopilotProposal }) {
  const args = proposal.arguments

  switch (proposal.tool) {
    case 'create_ticket':
      return <CreateProposal args={args} />
    case 'bulk_create_tickets':
      return <BulkProposal args={args} />
    case 'update_ticket':
      return <UpdateProposal args={args} />
    default:
      // An unknown tool still gets approved or cancelled; it just falls back to
      // the summary the executor produced.
      return (
        <div className="rounded-md border bg-background p-2.5 text-xs">{proposal.label}</div>
      )
  }
}

/* ------------------------------------------------------------------ pieces */

function Header({
  icon: Icon,
  action,
  projectCode,
}: {
  icon: React.ComponentType<{ className?: string }>
  action: string
  projectCode?: unknown
}) {
  return (
    <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1.5">
      <Icon className="size-3.5 shrink-0 text-primary" />
      <span className="text-[11px] font-semibold tracking-wide uppercase">{action}</span>
      {typeof projectCode === 'string' && projectCode.trim() !== '' && (
        <span className="ml-auto inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          <FolderGit2 className="size-2.5" />
          {projectCode}
        </span>
      )}
    </div>
  )
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2 px-2.5 py-1">
      <span className="flex w-[72px] shrink-0 items-center gap-1 pt-px text-[11px] text-muted-foreground">
        {Icon && <Icon className="size-3 shrink-0" />}
        {label}
      </span>
      <span className="min-w-0 flex-1 text-xs">{children}</span>
    </div>
  )
}

/** A value the model supplied, rendered only when it is a non-empty string. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function Chips({ values }: { values: unknown }) {
  if (!Array.isArray(values) || values.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {values.filter((v): v is string => typeof v === 'string').map((value) => (
        <span
          key={value}
          className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium"
        >
          {value}
        </span>
      ))}
    </span>
  )
}

/** A due date, shown as a real date when the executor will honour it verbatim. */
function Due({ days }: { days: unknown }) {
  if (typeof days !== 'number' || !Number.isFinite(days)) return null

  if (days < 0 || days > MAX_DUE_DAYS) {
    return (
      <>
        {days} days{' '}
        <span className="text-muted-foreground">— out of range, adjusted on approval</span>
      </>
    )
  }

  const date = new Date(Date.now() + days * 86_400_000)
  return (
    <>
      {format(date, 'd MMM yyyy')}{' '}
      <span className="text-muted-foreground">
        ({days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`})
      </span>
    </>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-md border bg-background">{children}</div>
}

/* --------------------------------------------------------------- proposals */

function CreateProposal({ args }: { args: Record<string, unknown> }) {
  const title = text(args.title)
  const description = text(args.description)

  return (
    <Shell>
      <Header icon={Plus} action="Create ticket" projectCode={args.projectCode} />

      <div className="px-2.5 pt-2 pb-1">
        <p className="text-sm leading-snug font-medium">{title ?? 'Untitled'}</p>
        {description && (
          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      <div className="border-t py-1">
        {text(args.priority) && <Field label="Priority">{text(args.priority)}</Field>}
        {text(args.type) && <Field label="Type">{text(args.type)}</Field>}
        {text(args.status) && <Field label="Status">{text(args.status)}</Field>}
        {text(args.assignee) && (
          <Field label="Assignee" icon={User}>
            {text(args.assignee)}
          </Field>
        )}
        {Array.isArray(args.labels) && args.labels.length > 0 && (
          <Field label="Labels" icon={Tag}>
            <Chips values={args.labels} />
          </Field>
        )}
        {args.dueInDays != null && (
          <Field label="Due" icon={CalendarClock}>
            <Due days={args.dueInDays} />
          </Field>
        )}
        {text(args.parentKey) && (
          <Field label="Parent" icon={GitBranch}>
            <span className="font-mono">{text(args.parentKey)}</span>
          </Field>
        )}
      </div>
    </Shell>
  )
}

/**
 * A bulk create may carry up to 30 children. Listing them all would push the
 * approve button off the panel, which is the one control that must stay
 * reachable — so the tail is summarised instead.
 */
const MAX_VISIBLE_CHILDREN = 8

function BulkProposal({ args }: { args: Record<string, unknown> }) {
  const children = Array.isArray(args.children) ? args.children : []
  const visible = children.slice(0, MAX_VISIBLE_CHILDREN)
  const hidden = children.length - visible.length
  const parentTitle = text(args.parentTitle)
  const parentDescription = text(args.parentDescription)

  return (
    <Shell>
      <Header
        icon={ListTree}
        action={`1 parent + ${children.length} ${children.length === 1 ? 'child' : 'children'}`}
        projectCode={args.projectCode}
      />

      <div className="px-2.5 pt-2 pb-1.5">
        <p className="text-sm leading-snug font-medium">{parentTitle ?? 'Untitled'}</p>
        {parentDescription && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {parentDescription}
          </p>
        )}
      </div>

      <ol className="border-t">
        {visible.map((child, index) => {
          const entry = (child ?? {}) as Record<string, unknown>
          return (
            <li
              key={index}
              className="flex gap-2 border-b px-2.5 py-1.5 last:border-b-0"
            >
              <span className="w-4 shrink-0 pt-px text-right font-mono text-[10px] text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug">{text(entry.title) ?? 'Untitled'}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {text(entry.assignee) && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <User className="size-2.5" />
                      {text(entry.assignee)}
                    </span>
                  )}
                  <Chips values={entry.labels} />
                </div>
              </div>
            </li>
          )
        })}
        {hidden > 0 && (
          <li className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
            + {hidden} more child {hidden === 1 ? 'ticket' : 'tickets'}
          </li>
        )}
      </ol>
    </Shell>
  )
}

function UpdateProposal({ args }: { args: Record<string, unknown> }) {
  const ticketKey = text(args.ticketKey)

  // Only the new value is known here — the Copilot proposes a change without
  // reading the current row — so each line reads as a destination, not a diff.
  const changes: Array<{ label: string; icon?: React.ComponentType<{ className?: string }>; node: React.ReactNode }> = []

  if (text(args.status)) changes.push({ label: 'Status', node: text(args.status) })
  if (text(args.priority)) changes.push({ label: 'Priority', node: text(args.priority) })
  if (text(args.assignee)) {
    const assignee = text(args.assignee)
    changes.push({
      label: 'Assignee',
      icon: User,
      node: assignee?.toLowerCase() === 'none' ? <span className="italic">Unassigned</span> : assignee,
    })
  }
  if (text(args.title)) changes.push({ label: 'Rename to', icon: Pencil, node: text(args.title) })
  if (args.dueInDays != null)
    changes.push({ label: 'Due', icon: CalendarClock, node: <Due days={args.dueInDays} /> })
  if (Array.isArray(args.addLabels) && args.addLabels.length > 0)
    changes.push({ label: 'Add labels', icon: Tag, node: <Chips values={args.addLabels} /> })

  return (
    <Shell>
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1.5">
        <Pencil className="size-3.5 shrink-0 text-primary" />
        <span className="text-[11px] font-semibold tracking-wide uppercase">Update</span>
        {ticketKey && (
          <span className="ml-auto rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">
            {ticketKey}
          </span>
        )}
      </div>

      <div className="py-1">
        {changes.length === 0 ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground italic">
            No fields specified.
          </p>
        ) : (
          changes.map((change) => (
            <Field key={change.label} label={change.label} icon={change.icon}>
              <span className="flex items-center gap-1">
                <ArrowRight className={cn('size-3 shrink-0 text-muted-foreground')} />
                {change.node}
              </span>
            </Field>
          ))
        )}
      </div>
    </Shell>
  )
}
