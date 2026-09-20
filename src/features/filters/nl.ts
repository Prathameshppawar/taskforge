import { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'

import { getAiProvider, type AiMessage } from '@/infrastructure/ai'
import type { Actor } from '@/features/auth/guards'
import {
  resolveLabels,
  resolvePriority,
  resolveStatus,
  resolveType,
  resolveUser,
  daysFromNow,
} from '@/features/ai/resolver'
import { EMPTY_FILTERS, type TicketFilters } from './types'

/**
 * "Everything Prakhar is blocked on this month" as a real filter.
 *
 * The model never produces a query, or ids, or SQL. It produces *names* — the
 * words a person actually used — and the server resolves those against the
 * project exactly as the Copilot's tools do. That makes this read-only by
 * construction, and it makes a wrong answer visible and correctable rather than
 * silently wrong: what comes back is an ordinary filter the user can see in the
 * toolbar, adjust and save.
 */

const filterTool = z.object({
  assignee: z.string().optional().describe('A person\'s name or username, or "me"'),
  status: z.string().optional().describe('A named status, e.g. "In Review"'),
  statusCategory: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED'])
    .optional()
    .describe('Use for broad words like blocked, done, in progress'),
  priority: z.string().optional(),
  type: z.string().optional(),
  labels: z.array(z.string()).optional(),
  search: z.string().optional().describe('Free text to match in the title or description'),
  overdueOnly: z.boolean().optional(),
  unassignedOnly: z.boolean().optional(),
  parentsOnly: z.boolean().optional(),
  dueWithinDays: z.number().int().optional().describe('Due in the next N days'),
  createdWithinDays: z.number().int().optional().describe('Created in the last N days'),
})

export type FilterDraft = z.infer<typeof filterTool>

function systemPrompt(today: string): string {
  return [
    'You turn a plain-English request into ticket filter settings.',
    `Today is ${today}.`,
    'Call build_filter exactly once.',
    'Use names exactly as the person wrote them — they are resolved against the project afterwards. Never invent ids.',
    'Prefer statusCategory for broad words (blocked, done, in progress) and status only when a specific named column is meant.',
    '"this week" is dueWithinDays 7, "this month" is 30. "recently" is createdWithinDays 14.',
    // Without this the model puts the whole sentence into `search`, which
    // matches nothing and looks like the feature is broken.
    'Only set search for words that would literally appear in a ticket title. Do not put the whole request in it.',
    'Leave anything the request does not mention unset.',
  ].join('\n')
}

export interface FilterInterpretation {
  filters: TicketFilters
  /** What was understood, in the user's terms, plus anything that did not resolve. */
  summary: string[]
  unresolved: string[]
}

export async function interpretFilter(
  request: string,
  actor: Actor,
  projectId: string,
): Promise<FilterInterpretation | { error: string }> {
  const provider = getAiProvider()

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt(new Date().toISOString().slice(0, 10)) },
    { role: 'user', content: request.trim().slice(0, 500) },
  ]

  const response = await provider.chat({
    messages,
    tools: [
      {
        name: 'build_filter',
        description: 'Set the ticket filters matching the request.',
        parameters: zodToJsonSchema(filterTool, { target: 'openApi3' }) as Record<
          string,
          unknown
        >,
      },
    ],
  })

  const call = response.toolCalls.find((entry) => entry.name === 'build_filter')
  if (!call) {
    return { error: response.content.trim() || 'That could not be turned into a filter.' }
  }

  const parsed = filterTool.safeParse(call.arguments)
  if (!parsed.success) return { error: 'The filter came back malformed. Try rephrasing.' }

  return resolveDraft(parsed.data, actor, projectId)
}

/** Turns names into ids, reporting anything the project does not have. */
export async function resolveDraft(
  draft: FilterDraft,
  actor: Actor,
  projectId: string,
): Promise<FilterInterpretation> {
  const filters: TicketFilters = { ...EMPTY_FILTERS, projectIds: [projectId] }
  const summary: string[] = []
  const unresolved: string[] = []

  if (draft.assignee) {
    const user = await resolveUser(actor, projectId, draft.assignee)
    if (user) {
      filters.assigneeIds = [user.id]
      summary.push(`assigned to ${user.name}`)
    } else {
      unresolved.push(`no project member matched "${draft.assignee}"`)
    }
  }

  if (draft.status) {
    const status = await resolveStatus(projectId, draft.status)
    if (status) {
      filters.statusIds = [status.id]
      summary.push(`status is ${status.name}`)
    } else {
      unresolved.push(`no status named "${draft.status}"`)
    }
  }

  if (draft.statusCategory) {
    filters.statusCategories = [draft.statusCategory]
    summary.push(draft.statusCategory.toLowerCase().replace('_', ' '))
  }

  if (draft.priority) {
    const priority = await resolvePriority(projectId, draft.priority)
    if (priority) {
      filters.priorityIds = [priority.id]
      summary.push(`${priority.name} priority`)
    } else {
      unresolved.push(`no priority named "${draft.priority}"`)
    }
  }

  if (draft.type) {
    const type = await resolveType(projectId, draft.type)
    if (type) {
      filters.typeIds = [type.id]
      summary.push(`type is ${type.name}`)
    } else {
      unresolved.push(`no type named "${draft.type}"`)
    }
  }

  if (draft.labels?.length) {
    const labels = await resolveLabels(projectId, draft.labels)
    if (labels.length) {
      filters.labelIds = labels.map((label) => label.id)
      summary.push(`labelled ${labels.map((label) => label.name).join(', ')}`)
    }
    const missing = draft.labels.length - labels.length
    if (missing > 0) unresolved.push(`${missing} label${missing === 1 ? '' : 's'} not found`)
  }

  if (draft.search) {
    filters.search = draft.search
    summary.push(`matching "${draft.search}"`)
  }

  if (draft.overdueOnly) {
    filters.overdueOnly = true
    summary.push('overdue')
  }
  if (draft.unassignedOnly) {
    filters.unassignedOnly = true
    summary.push('unassigned')
  }
  if (draft.parentsOnly) {
    filters.parentsOnly = true
    summary.push('parents only')
  }

  if (draft.dueWithinDays != null) {
    const days = Math.max(0, Math.min(draft.dueWithinDays, 3650))
    filters.dueTo = daysFromNow(days)
    summary.push(`due within ${days} days`)
  }

  if (draft.createdWithinDays != null) {
    const days = Math.max(0, Math.min(draft.createdWithinDays, 3650))
    filters.createdFrom = daysFromNow(-days)
    summary.push(`created in the last ${days} days`)
  }

  return { filters, summary, unresolved }
}
