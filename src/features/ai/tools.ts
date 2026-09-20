import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import type { AiToolDefinition } from '@/infrastructure/ai'

/**
 * Copilot tool contracts.
 *
 * NOTE ON NUMERIC BOUNDS: Groq validates tool arguments against this JSON
 * Schema on its side and rejects the whole request with a 400 if they do not
 * match — the call never reaches us, so we cannot correct it. A model that
 * emits `limit: 0` to mean "no limit" therefore breaks the entire turn.
 *
 * So bounds are deliberately absent from the model-facing schema and enforced
 * by clamping in the executor instead. Being strict here buys nothing: it
 * converts a recoverable value into an unrecoverable failure.
 *
 *
 * The Zod schema is the single source of truth: the JSON Schema handed to the
 * model is generated from it, so the model-facing contract and the server-side
 * trust boundary cannot drift apart.
 *
 * IMPORTANT: a tool call is untrusted input. The model never touches the
 * database — each call is validated here and then dispatched to the very same
 * Server Actions the UI uses, so it inherits every permission check and audit
 * entry automatically. The Copilot therefore cannot do anything the signed-in
 * user could not do by hand.
 */

export const createTicketTool = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  projectCode: z.string().optional().describe('Omit to use the open project.'),
  priority: z.string().optional().describe('Low|Medium|High|Critical|Blocker'),
  type: z.string().optional().describe('Task|Bug|Story|Improvement|Research|Hotfix'),
  status: z.string().optional(),
  assignee: z.string().optional().describe('Username or name'),
  labels: z.array(z.string()).optional(),
  dueInDays: z.number().int().optional(),
  parentKey: z.string().optional().describe('Parent key, e.g. RC-4'),
})

export const bulkCreateTool = z.object({
  projectCode: z.string().optional(),
  parentTitle: z.string().min(3).max(200),
  parentDescription: z.string().max(5000).optional(),
  children: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        description: z.string().max(2000).optional(),
        assignee: z.string().optional(),
        labels: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(30),
})

export const searchTicketsTool = z.object({
  query: z.string().optional(),
  projectCode: z.string().optional(),
  status: z.string().optional(),
  statusCategory: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED'])
    .optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  label: z.string().optional(),
  assignee: z.string().optional().describe('Username, name, or "me"'),
  overdueOnly: z.boolean().optional(),
  unassignedOnly: z.boolean().optional(),
  limit: z.number().int().optional(),
})

export const updateTicketTool = z.object({
  ticketKey: z.string().describe('e.g. RC-14'),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignee: z.string().optional().describe('Name, or "none" to unassign'),
  dueInDays: z.number().int().optional(),
  addLabels: z.array(z.string()).optional(),
  title: z.string().min(3).max(200).optional(),
})

export const projectInsightsTool = z.object({
  projectCode: z.string().optional(),
})

export const getTicketTool = z.object({
  ticketKey: z.string().describe('e.g. RC-14'),
})

export const commentTool = z.object({
  ticketKey: z.string().describe('e.g. RC-14'),
  body: z.string().min(1).max(5000).describe('Markdown. Use @username to notify someone.'),
})

export const findDuplicatesTool = z.object({
  title: z.string().min(3),
  projectCode: z.string().optional(),
})

export const TOOL_SCHEMAS = {
  create_ticket: createTicketTool,
  bulk_create_tickets: bulkCreateTool,
  search_tickets: searchTicketsTool,
  update_ticket: updateTicketTool,
  project_insights: projectInsightsTool,
  find_duplicates: findDuplicatesTool,
  get_ticket: getTicketTool,
  comment_on_ticket: commentTool,
} as const

export type ToolName = keyof typeof TOOL_SCHEMAS

/**
 * Tool descriptions are deliberately terse. Every character here is re-sent on
 * every request, and Groq's free tier allows only 8,000 tokens per minute —
 * verbose descriptions cost the user conversations per minute.
 */
const DESCRIPTIONS: Record<ToolName, string> = {
  create_ticket: 'Create one ticket.',
  bulk_create_tickets:
    'Create a parent ticket plus child tasks. Use when breaking work down or given several related tasks.',
  search_tickets: 'Find tickets by filter. Use for "show blocked", "my critical bugs".',
  update_ticket: 'Change a ticket: status, assignee, priority, due date, title.',
  project_insights:
    'Everything about a project: description, dates, owner, team, labels, types, plus completion, overdue and workload. Use for "what is this project", "when is it due", "who is on it".',
  find_duplicates: 'Check for similar existing tickets before creating one.',
  get_ticket:
    'Read one ticket in full: description, remarks, labels, dates, its parent and children, and recent comments.',
  comment_on_ticket: 'Post a comment. @username notifies that person.',
}

/**
 * Lets every optional property also be null.
 *
 * Models routinely fill a field they have no value for with an explicit `null`
 * rather than omitting it. Zod's `.optional()` produces `"type": "string"` and
 * leaves the key out of `required`, which says "you may omit this" — not "you
 * may send null". Groq validates the tool call against this schema *server
 * side* and rejects the whole call, so one stray null loses the entire turn
 * with an error the user can do nothing about.
 *
 * Widening here rather than changing every schema keeps the Zod types honest:
 * internally a field is still `string | undefined`, and `dropNulls` below turns
 * the model's nulls into omissions before anything validates them.
 */
export function allowNulls(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties) return schema

  const required = new Set((schema.required as string[] | undefined) ?? [])

  for (const [key, property] of Object.entries(properties)) {
    if (required.has(key)) continue

    const type = property.type
    if (typeof type === 'string' && type !== 'null') {
      property.type = [type, 'null']
    } else if (Array.isArray(type) && !type.includes('null')) {
      property.type = [...type, 'null']
    }

    /*
     * An enum constrains the value as well as the type, so widening the type
     * alone is not enough: null passes `type` and then fails `enum`, and the
     * call is rejected for a field the model was told it could leave out.
     */
    if (Array.isArray(property.enum) && !property.enum.includes(null)) {
      property.enum = [...property.enum, null]
    }
  }

  return schema
}

/**
 * Removes null-valued keys so an optional field reads as absent.
 *
 * The counterpart to `allowNulls`: the schema tolerates the model's nulls, and
 * this turns them back into the omissions the Zod schemas expect. Without it
 * every `.optional()` would have to become `.nullable().optional()` and every
 * downstream check would have to handle a third state that means nothing.
 */
export function dropNulls(args: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(args)) {
    if (value === null) continue

    // Children of a bulk create arrive as objects carrying their own nulls.
    if (Array.isArray(value)) {
      cleaned[key] = value.map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? dropNulls(entry as Record<string, unknown>)
          : entry,
      )
      continue
    }

    if (value && typeof value === 'object') {
      cleaned[key] = dropNulls(value as Record<string, unknown>)
      continue
    }

    cleaned[key] = value
  }

  return cleaned
}

/** Tool list handed to the model, with JSON Schema generated from Zod. */
export function getToolDefinitions(): AiToolDefinition[] {
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => {
    const jsonSchema = zodToJsonSchema(TOOL_SCHEMAS[name], {
      target: 'openApi3',
      $refStrategy: 'none',
    }) as Record<string, unknown>

    // Providers reject a schema carrying $schema; strip it.
    delete jsonSchema.$schema

    return {
      name,
      description: DESCRIPTIONS[name],
      parameters: allowNulls(jsonSchema),
    }
  })
}

/** Tools that change data. These are proposed to the user, never auto-applied. */
export const MUTATING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'comment_on_ticket',
  'create_ticket',
  'bulk_create_tickets',
  'update_ticket',
])

export function isToolName(value: string): value is ToolName {
  return value in TOOL_SCHEMAS
}
