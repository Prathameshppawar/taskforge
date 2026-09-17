import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import type { AiToolDefinition } from '@/infrastructure/ai'

/**
 * Copilot tool contracts.
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
  title: z.string().min(3).max(200).describe('Short, specific ticket title.'),
  description: z.string().max(5000).optional().describe('Fuller detail of the work.'),
  projectCode: z
    .string()
    .optional()
    .describe('Project code such as ATLAS. Omit to use the project currently open.'),
  priority: z
    .string()
    .optional()
    .describe('Priority name, e.g. Low, Medium, High, Critical, Blocker.'),
  type: z
    .string()
    .optional()
    .describe('Ticket type name, e.g. Task, Bug, Story, Improvement, Research, Hotfix.'),
  status: z.string().optional().describe('Status name. Defaults to the project initial status.'),
  assignee: z
    .string()
    .optional()
    .describe('Username or full name of the person to assign.'),
  labels: z.array(z.string()).optional().describe('Label names to attach.'),
  dueInDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .optional()
    .describe('Days from today for the due date.'),
  parentKey: z
    .string()
    .optional()
    .describe('Ticket key of the parent, e.g. ATLAS-4, to create this as a child.'),
})

export const bulkCreateTool = z.object({
  projectCode: z.string().optional().describe('Project code. Omit to use the open project.'),
  parentTitle: z.string().min(3).max(200).describe('Title of the parent feature ticket.'),
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
    .max(30)
    .describe('The implementation tasks belonging to the parent.'),
})

export const searchTicketsTool = z.object({
  query: z.string().optional().describe('Free text to match in title or description.'),
  projectCode: z.string().optional(),
  status: z.string().optional().describe('Status name, e.g. Blocked, In Progress.'),
  statusCategory: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED'])
    .optional()
    .describe('Use when the user names a stage rather than an exact status.'),
  priority: z.string().optional(),
  type: z.string().optional(),
  label: z.string().optional().describe('A single label name to filter by.'),
  assignee: z
    .string()
    .optional()
    .describe('Username, full name, or the literal "me" for the current user.'),
  overdueOnly: z.boolean().optional(),
  unassignedOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

export const updateTicketTool = z.object({
  ticketKey: z.string().describe('Ticket key, e.g. ATLAS-14.'),
  status: z.string().optional().describe('New status name.'),
  priority: z.string().optional().describe('New priority name.'),
  assignee: z
    .string()
    .optional()
    .describe('Username or full name. Use "none" to unassign.'),
  dueInDays: z.number().int().min(0).max(365).optional(),
  addLabels: z.array(z.string()).optional(),
  title: z.string().min(3).max(200).optional(),
})

export const projectInsightsTool = z.object({
  projectCode: z.string().optional().describe('Project code. Omit to use the open project.'),
})

export const findDuplicatesTool = z.object({
  title: z.string().min(3).describe('The prospective ticket title to check.'),
  projectCode: z.string().optional(),
})

export const TOOL_SCHEMAS = {
  create_ticket: createTicketTool,
  bulk_create_tickets: bulkCreateTool,
  search_tickets: searchTicketsTool,
  update_ticket: updateTicketTool,
  project_insights: projectInsightsTool,
  find_duplicates: findDuplicatesTool,
} as const

export type ToolName = keyof typeof TOOL_SCHEMAS

const DESCRIPTIONS: Record<ToolName, string> = {
  create_ticket:
    'Create a single ticket. Use when the user describes one piece of work.',
  bulk_create_tickets:
    'Create a parent feature ticket together with its child implementation tasks. Use when the user asks to break something down or lists several related tasks.',
  search_tickets:
    'Find tickets matching filters. Use for any question about what exists, such as "show blocked tickets" or "my critical bugs".',
  update_ticket:
    'Change an existing ticket: move its status, reassign it, change priority or due date.',
  project_insights:
    'Retrieve health metrics for a project — completion, overdue count, workload and status spread. Use to answer "how is the project doing?".',
  find_duplicates:
    'Check whether similar tickets already exist before creating one. Call this first whenever the user asks to create a ticket.',
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
      parameters: jsonSchema,
    }
  })
}

/** Tools that change data. These are proposed to the user, never auto-applied. */
export const MUTATING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'create_ticket',
  'bulk_create_tickets',
  'update_ticket',
])

export function isToolName(value: string): value is ToolName {
  return value in TOOL_SCHEMAS
}
