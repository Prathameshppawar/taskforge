import { prisma } from '@/infrastructure/db/prisma'
import type { Actor } from '@/features/auth/guards'
import {
  createTicketAction,
  bulkCreateTicketsAction,
  updateTicketAction,
  createCommentAction,
} from '@/features/tickets/actions'
import { listTickets, findSimilarTickets } from '@/features/tickets/queries'
import {
  getCompletionRate,
  getStatCounts,
  getStatusDistribution,
  getTeamWorkload,
} from '@/features/dashboard/queries'
import { EMPTY_FILTERS } from '@/features/filters/types'
import { MUTATING_TOOLS, TOOL_SCHEMAS, type ToolName, dropNulls} from './tools'
import { requireProjectPermission, requireProjectView } from '@/features/auth/guards'
import {
  daysFromNow,
  resolveLabels,
  resolvePriority,
  resolveProject,
  resolveStatus,
  resolveTicketByKey,
  resolveType,
  resolveUser,
} from './resolver'

/**
 * Tool dispatch.
 *
 * Every mutating tool goes through the same Server Action the UI calls, so the
 * Copilot inherits the permission check, the transaction and the audit entry.
 * There is no privileged path for the model.
 */

export interface ToolResult {
  ok: boolean
  /** Text fed back to the model so it can narrate what happened. */
  summary: string
  /**
   * What the panel shows when nobody narrates the result.
   *
   * `summary` is written for a model: it restates every row so the model can
   * reason about the data it just asked for. The panel is not a model — it
   * already renders those rows as a card — so printing the summary underneath
   * says the same thing twice. Slash commands hit this directly, since they
   * skip the provider entirely and have no reply of their own.
   *
   * An empty string means the card IS the answer. Left unset when there is no
   * card, in which case the summary is all the user would get.
   */
  reply?: string
  /** Structured payload rendered as a rich card in the panel. */
  data?: unknown
  /** Set when this is a proposal awaiting approval rather than a done deed. */
  proposal?: {
    tool: ToolName
    arguments: Record<string, unknown>
    /** One line describing the effect, shown on the confirm button. */
    label: string
  }
}

/** Bounds the model's numbers rather than rejecting them. Exported for tests. */
export function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export interface ExecutionContext {
  actor: Actor
  /** Project the user currently has open, used when the model omits one. */
  currentProjectId?: string
  /**
   * When true, mutating tools describe what they WOULD do and change nothing.
   *
   * The permission check still runs, so a proposal the actor is not allowed to
   * perform is refused at proposal time rather than after they approve it.
   */
  propose?: boolean
}

export async function executeTool(
  name: ToolName,
  rawArgs: Record<string, unknown>,
  context: ExecutionContext,
): Promise<ToolResult> {
  // The model's arguments are untrusted input — validate before anything else.
  // Models fill fields they have no value for with an explicit null; the schema
  // tolerates that, and this turns them back into the omissions Zod expects.
  const parsed = TOOL_SCHEMAS[name].safeParse(dropNulls(rawArgs))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ')
    return { ok: false, summary: `Invalid arguments — ${issues}` }
  }

  /*
   * Writes are proposed, not performed, unless the caller has already approved
   * them. The permission check still runs first — being told "approve?" and
   * then "you are not allowed" would be worse than being refused outright.
   */
  if (context.propose && MUTATING_TOOLS.has(name)) {
    const guard = await assertCanWrite(name, parsed.data as never, context)
    if (!guard.allowed) return guard.result

    return {
      ok: true,
      summary: `Proposed: ${describe(name, parsed.data as never)}. Awaiting the user's approval — do not claim it is done.`,
      // The approval block spells the change out and asks the question. This
      // summary is an instruction to the model, not a sentence for a person.
      reply: '',
      proposal: {
        tool: name,
        // The resolved project wins over whatever the model supplied: it is
        // what the write will actually use.
        arguments: guard.projectCode
          ? { ...rawArgs, projectCode: guard.projectCode }
          : rawArgs,
        label: describe(name, parsed.data as never),
      },
    }
  }

  switch (name) {
    case 'get_ticket':
      return getTicket(parsed.data as never, context)
    case 'comment_on_ticket':
      return commentOnTicket(parsed.data as never, context)
    case 'find_duplicates':
      return findDuplicates(parsed.data as never, context)
    case 'search_tickets':
      return searchTickets(parsed.data as never, context)
    case 'create_ticket':
      return createTicket(parsed.data as never, context)
    case 'bulk_create_tickets':
      return bulkCreate(parsed.data as never, context)
    case 'update_ticket':
      return updateTicket(parsed.data as never, context)
    case 'project_insights':
      return projectInsights(parsed.data as never, context)
  }
}

/** Human sentence for a pending write, shown on the approval button. */
function describe(name: ToolName, args: Record<string, unknown>): string {
  switch (name) {
    case 'create_ticket':
      return `create "${args.title}"${args.assignee ? ` for ${args.assignee}` : ''}`
    case 'bulk_create_tickets': {
      const children = (args.children as unknown[] | undefined)?.length ?? 0
      return `create "${args.parentTitle}" with ${children} child ${children === 1 ? 'ticket' : 'tickets'}`
    }
    case 'update_ticket': {
      const bits: string[] = []
      if (args.status) bits.push(`status → ${args.status}`)
      if (args.priority) bits.push(`priority → ${args.priority}`)
      if (args.assignee) bits.push(`assign to ${args.assignee}`)
      if (args.title) bits.push('rename')
      if (args.dueInDays != null) bits.push(`due in ${args.dueInDays} days`)
      return `update ${args.ticketKey}: ${bits.join(', ') || 'no changes'}`
    }
    default:
      return name
  }
}

/**
 * Runs the permission check a write would hit, without performing it.
 *
 * Also hands back the project the write resolved to. The model may omit the
 * project entirely — "create a ticket" while a board is open is the common
 * case — so this is the only place that knows where the ticket will actually
 * land, and the approval card should show that rather than leave it implied.
 */
type WriteGuard =
  | { allowed: false; result: ToolResult }
  | { allowed: true; projectCode?: string }

async function assertCanWrite(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<WriteGuard> {
  try {
    if (name === 'update_ticket') {
      const ticket = await resolveTicketByKey(ctx.actor, String(args.ticketKey))
      await requireProjectPermission(ticket.projectId, 'ticket:update')
      // The ticket key already carries the project prefix, so the card has it.
      return { allowed: true }
    }
    if (name === 'comment_on_ticket') {
      const ticket = await resolveTicketByKey(ctx.actor, String(args.ticketKey))
      await requireProjectPermission(ticket.projectId, 'comment:create')
      return { allowed: true }
    }
    const project = await resolveProject(
      ctx.actor,
      args.projectCode as string | undefined,
      ctx.currentProjectId,
    )
    await requireProjectPermission(project.id, 'ticket:create')
    return { allowed: true, projectCode: project.code }
  } catch (error) {
    return {
      allowed: false,
      result: {
        ok: false,
        summary: error instanceof Error ? error.message : 'You cannot do that.',
      },
    }
  }
}

// -----------------------------------------------------------------------------

type CreateArgs = ReturnType<(typeof TOOL_SCHEMAS)['create_ticket']['parse']>

async function createTicket(args: CreateArgs, ctx: ExecutionContext): Promise<ToolResult> {
  const project = await resolveProject(ctx.actor, args.projectCode, ctx.currentProjectId)

  if (project.isArchived) {
    return { ok: false, summary: `${project.name} is archived, so tickets cannot be added.` }
  }

  const [status, priority, type, labels, assignee] = await Promise.all([
    resolveStatus(project.id, args.status),
    resolvePriority(project.id, args.priority),
    resolveType(project.id, args.type),
    resolveLabels(project.id, args.labels),
    resolveUser(ctx.actor, project.id, args.assignee),
  ])

  // An unresolved assignee is reported rather than silently dropped — leaving
  // work unassigned when the user named someone is worse than saying so.
  const warnings: string[] = []
  if (args.assignee && !assignee && args.assignee.toLowerCase() !== 'none') {
    warnings.push(`no project member matched "${args.assignee}", so it is unassigned`)
  }
  if (args.priority && !priority) warnings.push(`priority "${args.priority}" was not found`)
  if (args.type && !type) warnings.push(`type "${args.type}" was not found`)

  let parentId: string | undefined
  if (args.parentKey) {
    const parent = await resolveTicketByKey(ctx.actor, args.parentKey)
    parentId = parent.id
  }

  const result = await createTicketAction({
    projectId: project.id,
    title: args.title,
    description: args.description ?? '',
    remarks: '',
    statusId: status?.id,
    priorityId: priority?.id,
    typeId: type?.id,
    assigneeId: assignee?.id ?? null,
    parentId: parentId ?? null,
    labelIds: labels.map((label) => label.id),
    dueDate: args.dueInDays != null ? daysFromNow(clamp(args.dueInDays, 0, 3650, 7)) : null,
    startDate: null,
    resources: [],
  })

  if (!result.success) return { ok: false, summary: result.error }

  return {
    ok: true,
    summary:
      `Created ${result.data.key} — "${args.title}" in ${project.name}` +
      (assignee ? `, assigned to ${assignee.name}` : '') +
      (warnings.length ? `. Note: ${warnings.join('; ')}` : '.'),
    reply: '',
    data: {
      kind: 'ticket_created',
      key: result.data.key,
      id: result.data.id,
      title: args.title,
      projectName: project.name,
      assignee: assignee?.name ?? null,
      warnings,
    },
  }
}

type BulkArgs = ReturnType<(typeof TOOL_SCHEMAS)['bulk_create_tickets']['parse']>

async function bulkCreate(args: BulkArgs, ctx: ExecutionContext): Promise<ToolResult> {
  const project = await resolveProject(ctx.actor, args.projectCode, ctx.currentProjectId)

  if (project.isArchived) {
    return { ok: false, summary: `${project.name} is archived, so tickets cannot be added.` }
  }

  const children = await Promise.all(
    args.children.map(async (child) => {
      const [labels, assignee] = await Promise.all([
        resolveLabels(project.id, child.labels),
        resolveUser(ctx.actor, project.id, child.assignee),
      ])
      return {
        title: child.title,
        description: child.description ?? '',
        assigneeId: assignee?.id ?? null,
        labelIds: labels.map((label) => label.id),
      }
    }),
  )

  const result = await bulkCreateTicketsAction({
    projectId: project.id,
    parent: {
      title: args.parentTitle,
      description: args.parentDescription ?? '',
      labelIds: [],
    },
    children,
  })

  if (!result.success) return { ok: false, summary: result.error }

  return {
    ok: true,
    summary: `Created ${result.data.parentKey} — "${args.parentTitle}" with ${result.data.childKeys.length} child tickets: ${result.data.childKeys.join(', ')}.`,
    reply: '',
    data: {
      kind: 'bulk_created',
      parentKey: result.data.parentKey,
      parentTitle: args.parentTitle,
      childKeys: result.data.childKeys,
      childTitles: args.children.map((child) => child.title),
      projectName: project.name,
    },
  }
}

type SearchArgs = ReturnType<(typeof TOOL_SCHEMAS)['search_tickets']['parse']>

async function searchTickets(args: SearchArgs, ctx: ExecutionContext): Promise<ToolResult> {
  /*
   * Scope to the open project when the caller did not name one.
   *
   * Previously the open project was used only to resolve status and label
   * NAMES, so "show blocked tickets" while looking at one project returned
   * blocked tickets from every project the user could see. That is not what
   * anyone means by the question — and over MCP, where the project is supplied
   * as context, it silently widened the search past the requested scope.
   */
  const projectId = args.projectCode
    ? (await resolveProject(ctx.actor, args.projectCode, undefined)).id
    : ctx.currentProjectId

  const scopeId = projectId

  const [status, priority, type, label, assignee] = scopeId
    ? await Promise.all([
        resolveStatus(scopeId, args.status),
        resolvePriority(scopeId, args.priority),
        resolveType(scopeId, args.type),
        args.label ? resolveLabels(scopeId, [args.label]) : Promise.resolve([]),
        resolveUser(ctx.actor, scopeId, args.assignee),
      ])
    : [null, null, null, [], args.assignee === 'me' ? { id: ctx.actor.id, name: ctx.actor.name } : null]

  const filters = {
    ...EMPTY_FILTERS,
    search: args.query,
    statusIds: status ? [status.id] : [],
    statusCategories: args.statusCategory ? [args.statusCategory] : [],
    priorityIds: priority ? [priority.id] : [],
    typeIds: type ? [type.id] : [],
    labelIds: label.map((l) => l.id),
    assigneeIds: assignee ? [assignee.id] : [],
    overdueOnly: args.overdueOnly ?? false,
    unassignedOnly: args.unassignedOnly ?? false,
    sortBy: 'priority' as const,
    sortDir: 'desc' as const,
  }

  const { items, total } = await listTickets(ctx.actor, filters, {
    projectId,
    // A model asking for 0 or 500 gets something sensible rather than an error.
    take: clamp(args.limit, 1, 50, 15),
  })

  if (items.length === 0) {
    return {
      ok: true,
      summary: 'No tickets matched those filters.',
      reply: '',
      data: { kind: 'search', tickets: [], total: 0 },
    }
  }

  const lines = items
    .map(
      (ticket) =>
        `${ticket.key} — ${ticket.title} [${ticket.status.name}, ${ticket.priority.name}${
          ticket.assignee ? `, ${ticket.assignee.name}` : ', unassigned'
        }]`,
    )
    .join('\n')

  return {
    ok: true,
    summary: `Found ${total} matching ${total === 1 ? 'ticket' : 'tickets'}${
      total > items.length ? ` (showing ${items.length})` : ''
    }:\n${lines}`,
    // The card lists every one of these with its status, priority and owner,
    // and counts them in its header — including the "showing N of M" case.
    reply: '',
    data: {
      kind: 'search',
      total,
      tickets: items.map((ticket) => ({
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
        status: ticket.status.name,
        statusColor: ticket.status.color,
        priority: ticket.priority.name,
        priorityColor: ticket.priority.color,
        priorityLevel: ticket.priority.level,
        assignee: ticket.assignee?.name ?? null,
        assigneeColor: ticket.assignee?.avatarColor ?? null,
        dueDate: ticket.dueDate?.toISOString() ?? null,
        projectCode: ticket.project.code,
      })),
    },
  }
}

type UpdateArgs = ReturnType<(typeof TOOL_SCHEMAS)['update_ticket']['parse']>

async function updateTicket(args: UpdateArgs, ctx: ExecutionContext): Promise<ToolResult> {
  const ticket = await resolveTicketByKey(ctx.actor, args.ticketKey)

  const [status, priority] = await Promise.all([
    resolveStatus(ticket.projectId, args.status),
    resolvePriority(ticket.projectId, args.priority),
  ])

  if (args.status && !status) {
    const available = await prisma.status.findMany({
      where: { projectId: ticket.projectId },
      select: { name: true },
      orderBy: { position: 'asc' },
    })
    return {
      ok: false,
      summary: `"${args.status}" is not a status in this project. Available: ${available
        .map((s) => s.name)
        .join(', ')}.`,
    }
  }

  const assignee =
    args.assignee != null
      ? await resolveUser(ctx.actor, ticket.projectId, args.assignee)
      : undefined

  if (args.assignee && !assignee && args.assignee.toLowerCase() !== 'none') {
    return {
      ok: false,
      summary: `No active member of this project matched "${args.assignee}".`,
    }
  }

  const addLabels = await resolveLabels(ticket.projectId, args.addLabels)

  const result = await updateTicketAction({
    id: ticket.id,
    title: args.title,
    statusId: status?.id,
    priorityId: priority?.id,
    assigneeId: args.assignee != null ? (assignee?.id ?? null) : undefined,
    dueDate: args.dueInDays != null ? daysFromNow(clamp(args.dueInDays, 0, 3650, 7)) : undefined,
    ...(addLabels.length > 0 ? { labelIds: addLabels.map((l) => l.id) } : {}),
  })

  if (!result.success) return { ok: false, summary: result.error }

  const changes: string[] = []
  if (status) changes.push(`status → ${status.name}`)
  if (priority) changes.push(`priority → ${priority.name}`)
  if (args.assignee != null) changes.push(assignee ? `assigned to ${assignee.name}` : 'unassigned')
  if (args.dueInDays != null) changes.push(`due in ${args.dueInDays} days`)
  if (args.title) changes.push('renamed')

  return {
    ok: true,
    summary: `Updated ${ticket.key}: ${changes.join(', ') || 'no changes'}.`,
    reply: '',
    data: {
      kind: 'ticket_updated',
      key: ticket.key,
      title: args.title ?? ticket.title,
      changes,
    },
  }
}

type InsightArgs = ReturnType<(typeof TOOL_SCHEMAS)['project_insights']['parse']>

async function projectInsights(args: InsightArgs, ctx: ExecutionContext): Promise<ToolResult> {
  const project = await resolveProject(ctx.actor, args.projectCode, ctx.currentProjectId)
  const scope = { projectId: project.id }

  /*
   * Deliberately returns the descriptive context alongside the metrics. Someone
   * new to a project asks "what is this and when is it due?" long before they
   * ask about throughput, and answering that from numbers alone is useless.
   */
  const [detail, stats, completion, statuses, workload] = await Promise.all([
    prisma.project.findUnique({
      where: { id: project.id },
      select: {
        description: true,
        status: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        owner: { select: { name: true, username: true } },
        members: {
          select: {
            role: true,
            user: { select: { name: true, username: true, jobTitle: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
        labels: { select: { name: true }, orderBy: { name: 'asc' } },
        priorities: { select: { name: true }, orderBy: { level: 'desc' } },
        ticketTypes: { select: { name: true }, orderBy: { position: 'asc' } },
      },
    }),
    getStatCounts(ctx.actor, scope),
    getCompletionRate(ctx.actor, scope),
    getStatusDistribution(ctx.actor, scope),
    getTeamWorkload(ctx.actor, scope),
  ])

  const fmt = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : null

  const daysLeft = detail?.endDate
    ? Math.ceil((detail.endDate.getTime() - Date.now()) / 86_400_000)
    : null

  const lines: string[] = [
    `Project: ${project.name} (${project.code}) — status ${detail?.status ?? 'unknown'}`,
  ]

  lines.push(
    detail?.description
      ? `About: ${detail.description}`
      : 'About: no description has been set.',
  )

  // Dates
  const dateBits: string[] = []
  if (detail?.startDate) dateBits.push(`started ${fmt(detail.startDate)}`)
  if (detail?.endDate) {
    dateBits.push(
      daysLeft !== null && daysLeft >= 0
        ? `target end ${fmt(detail.endDate)} (${daysLeft} days away)`
        : `target end ${fmt(detail.endDate)} (${Math.abs(daysLeft ?? 0)} days overdue)`,
    )
  }
  lines.push(dateBits.length ? `Dates: ${dateBits.join(', ')}.` : 'Dates: none set.')

  // Team
  if (detail?.members.length) {
    const team = detail.members
      .map((m) => `${m.user.name}${m.user.jobTitle ? ` (${m.user.jobTitle})` : ''} — ${m.role.toLowerCase()}`)
      .join('; ')
    lines.push(`Owner: ${detail.owner.name}. Team (${detail.members.length}): ${team}`)
  } else {
    lines.push(`Owner: ${detail?.owner.name ?? 'unknown'}. No other members yet.`)
  }

  // Configuration the user can reference when asking for tickets
  if (detail?.labels.length) {
    lines.push(`Labels available: ${detail.labels.map((l) => l.name).join(', ')}.`)
  }
  if (detail?.ticketTypes.length) {
    lines.push(`Ticket types: ${detail.ticketTypes.map((t) => t.name).join(', ')}.`)
  }
  if (detail?.priorities.length) {
    lines.push(`Priorities (high to low): ${detail.priorities.map((p) => p.name).join(', ')}.`)
  }

  // Health
  if (stats.total === 0) {
    lines.push('Tickets: none yet — the project is set up but no work has been logged.')
  } else {
    lines.push(
      `Progress: ${completion.percent}% — ${completion.completed} of ${completion.countable} done.`,
      `Open ${stats.open}, in progress ${stats.inProgress}, blocked ${stats.blocked}, done ${stats.done}. Overdue ${stats.overdue}, unassigned ${stats.unassigned}.`,
      `Status spread: ${statuses.map((s) => `${s.name} ${s.count}`).join(', ')}.`,
    )

    if (workload.length) {
      lines.push(
        `Workload: ${workload
          .slice(0, 8)
          .map((r) => `${r.name} ${r.total} (${r.blocked} blocked, ${r.overdue} overdue)`)
          .join('; ')}.`,
      )
    }
  }

  /*
   * The insights card is the one card that does NOT carry the whole answer: it
   * shows the health numbers and nothing else. So the panel line is what the
   * card leaves out — the timeline, who owns it, who is carrying the most —
   * rather than a restatement of the counts sitting directly above it.
   */
  const replyLines = [
    dateBits.length ? `Dates: ${dateBits.join(', ')}.` : null,
    `Owner: ${detail?.owner.name ?? 'unknown'}${
      detail?.members.length ? ` · team of ${detail.members.length}` : ''
    }.`,
    workload.length
      ? `Busiest: ${workload
          .slice(0, 3)
          .map((r) => `${r.name} ${r.total}`)
          .join(', ')}.`
      : null,
  ].filter((line): line is string => line !== null)

  return {
    ok: true,
    summary: lines.join('\n'),
    reply: replyLines.join('\n'),
    data: {
      kind: 'insights',
      projectName: project.name,
      projectCode: project.code,
      projectId: project.id,
      description: detail?.description ?? null,
      startDate: fmt(detail?.startDate),
      endDate: fmt(detail?.endDate),
      daysLeft,
      owner: detail?.owner.name ?? null,
      memberCount: detail?.members.length ?? 0,
      percent: completion.percent,
      stats,
      workload: workload.slice(0, 8),
    },
  }
}

type DuplicateArgs = ReturnType<(typeof TOOL_SCHEMAS)['find_duplicates']['parse']>

async function findDuplicates(
  args: DuplicateArgs,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  const project = await resolveProject(ctx.actor, args.projectCode, ctx.currentProjectId)
  const matches = await findSimilarTickets(project.id, args.title, 5)

  if (matches.length === 0) {
    return {
      ok: true,
      summary: 'No similar tickets exist — safe to create.',
      data: { kind: 'duplicates', matches: [] },
    }
  }

  return {
    ok: true,
    summary: `${matches.length} similar ${
      matches.length === 1 ? 'ticket' : 'tickets'
    } already exist:\n${matches
      .map((m) => `${m.key} — ${m.title} [${m.statusName}] (${Math.round(m.score * 100)}% similar)`)
      .join('\n')}\nMention these to the user before creating a duplicate.`,
    reply: '',
    data: { kind: 'duplicates', matches },
  }
}

// -----------------------------------------------------------------------------

type GetTicketArgs = ReturnType<(typeof TOOL_SCHEMAS)['get_ticket']['parse']>

/**
 * Reads one ticket in full.
 *
 * `search_tickets` returns rows for scanning; this returns everything an agent
 * needs to reason about a single piece of work — which is the difference
 * between "there is a ticket called X" and being able to act on it.
 */
async function getTicket(args: GetTicketArgs, ctx: ExecutionContext): Promise<ToolResult> {
  const ticket = await resolveTicketByKey(ctx.actor, args.ticketKey)

  // The key resolves before this, but visibility is still the guard that
  // decides whether this actor may read it.
  await requireProjectView(ticket.projectId)

  const full = await prisma.ticket.findUnique({
    where: { id: ticket.id },
    select: {
      key: true,
      title: true,
      description: true,
      remarks: true,
      startDate: true,
      dueDate: true,
      completedAt: true,
      estimateHours: true,
      storyPoints: true,
      status: { select: { name: true, category: true } },
      priority: { select: { name: true } },
      type: { select: { name: true } },
      assignee: { select: { name: true, username: true } },
      reporter: { select: { name: true, username: true } },
      project: { select: { code: true, name: true } },
      parent: { select: { key: true, title: true } },
      children: {
        select: { key: true, title: true, status: { select: { name: true } } },
        orderBy: { number: 'asc' },
      },
      labels: { select: { label: { select: { name: true } } } },
      comments: {
        where: { deletedAt: null },
        select: {
          body: true,
          createdAt: true,
          author: { select: { name: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  })

  if (!full) return { ok: false, summary: `${args.ticketKey} no longer exists.` }

  const lines = [
    `${full.key} — ${full.title}`,
    `${full.project.name} (${full.project.code}) · ${full.type.name} · ${full.priority.name} · ${full.status.name}`,
    full.assignee ? `Assignee: ${full.assignee.name} (@${full.assignee.username})` : 'Unassigned',
    full.reporter ? `Reporter: ${full.reporter.name}` : 'No reporter',
  ]

  if (full.dueDate) lines.push(`Due ${full.dueDate.toISOString().slice(0, 10)}`)
  if (full.storyPoints != null) lines.push(`${full.storyPoints} points`)
  if (full.labels.length) {
    lines.push(`Labels: ${full.labels.map((entry) => entry.label.name).join(', ')}`)
  }
  if (full.parent) lines.push(`Parent: ${full.parent.key} — ${full.parent.title}`)
  if (full.children.length) {
    lines.push(
      `Children:\n${full.children
        .map((child) => `  ${child.key} [${child.status.name}] ${child.title}`)
        .join('\n')}`,
    )
  }
  if (full.description) lines.push(`\nDescription:\n${full.description}`)
  if (full.remarks) lines.push(`\nRemarks:\n${full.remarks}`)
  if (full.comments.length) {
    lines.push(
      `\nRecent comments (newest first):\n${full.comments
        .map(
          (comment) =>
            `  @${comment.author.username} on ${comment.createdAt
              .toISOString()
              .slice(0, 10)}: ${comment.body.slice(0, 300)}`,
        )
        .join('\n')}`,
    )
  }

  return {
    ok: true,
    summary: lines.join('\n'),
    data: { kind: 'ticket', key: full.key, title: full.title },
  }
}

type CommentArgs = ReturnType<(typeof TOOL_SCHEMAS)['comment_on_ticket']['parse']>

/**
 * Posts a comment.
 *
 * Routed through the same Server Action the comment box uses, so @mentions are
 * resolved, the people mentioned are notified and the activity entry is written
 * in the same transaction — none of which would happen if this wrote to the
 * comments table directly.
 */
async function commentOnTicket(
  args: CommentArgs,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  const ticket = await resolveTicketByKey(ctx.actor, args.ticketKey)

  const result = await createCommentAction({ ticketId: ticket.id, body: args.body })
  if (!result.success) return { ok: false, summary: result.error }

  return {
    ok: true,
    summary: `Commented on ${ticket.key}.`,
    data: { kind: 'comment', ticketKey: ticket.key },
  }
}
