import type { ToolName } from './tools'

/**
 * Slash commands.
 *
 * The point is not shorthand — it is skipping the model entirely.
 *
 * "show me my overdue tickets" costs a round trip to Groq, about 1,400 tokens,
 * a second or two of latency, and carries whatever risk of misrouting the evals
 * have not caught. `/overdue` is the same tool call, parsed deterministically,
 * in no tokens and no wait. On a free tier of roughly 142 requests a day across
 * the whole workspace, spending one on a request that needs no judgement is
 * waste.
 *
 * So every command here resolves to a tool call with NO model involved. The
 * parser is pure — no database, no network — which is what lets it be asserted
 * in the domain suite alongside the rest of the rules.
 */

export interface SlashCommand {
  name: string
  /** Shown after the name in the menu, e.g. "RC-14 <text>". */
  hint?: string
  description: string
  /** Read commands run immediately; writes still go through propose-confirm. */
  mutates: boolean
  /** True when the command needs an argument to do anything. */
  requiresArgs?: boolean
  /** Turns the raw argument string into a tool call. */
  build: (args: string) => { tool: ToolName; arguments: Record<string, unknown> } | null
}

/** Splits "RC-14 rest of the text" into its key and the remainder. */
function splitKey(args: string): { key: string; rest: string } | null {
  const match = /^\s*([A-Za-z][A-Za-z0-9]*-\d+)\s*(.*)$/s.exec(args)
  if (!match) return null
  return { key: match[1].toUpperCase(), rest: match[2].trim() }
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'find',
    hint: '<text>',
    description: 'Search tickets',
    mutates: false,
    requiresArgs: true,
    build: (args) => (args.trim() ? { tool: 'search_tickets', arguments: { query: args.trim() } } : null),
  },
  {
    name: 'mine',
    description: 'Tickets assigned to me',
    mutates: false,
    build: () => ({ tool: 'search_tickets', arguments: { assignee: 'me' } }),
  },
  {
    name: 'overdue',
    description: 'Everything past its due date',
    mutates: false,
    build: () => ({ tool: 'search_tickets', arguments: { overdueOnly: true } }),
  },
  {
    name: 'blocked',
    description: 'Everything currently blocked',
    mutates: false,
    build: () => ({ tool: 'search_tickets', arguments: { statusCategory: 'BLOCKED' } }),
  },
  {
    name: 'unassigned',
    description: 'Work nobody owns yet',
    mutates: false,
    build: () => ({ tool: 'search_tickets', arguments: { unassignedOnly: true } }),
  },
  {
    name: 'ticket',
    hint: 'RC-14',
    description: 'Read one ticket in full',
    mutates: false,
    requiresArgs: true,
    build: (args) => {
      const parsed = splitKey(args)
      return parsed ? { tool: 'get_ticket', arguments: { ticketKey: parsed.key } } : null
    },
  },
  {
    name: 'insights',
    description: 'How this project is doing',
    mutates: false,
    build: () => ({ tool: 'project_insights', arguments: {} }),
  },
  {
    name: 'dupes',
    hint: '<title>',
    description: 'Check for similar tickets',
    mutates: false,
    requiresArgs: true,
    build: (args) =>
      args.trim().length >= 3 ? { tool: 'find_duplicates', arguments: { title: args.trim() } } : null,
  },
  {
    name: 'new',
    hint: '<title>',
    description: 'Create a ticket',
    mutates: true,
    requiresArgs: true,
    build: (args) =>
      args.trim().length >= 3 ? { tool: 'create_ticket', arguments: { title: args.trim() } } : null,
  },
  {
    name: 'comment',
    hint: 'RC-14 <text>',
    description: 'Comment on a ticket',
    mutates: true,
    requiresArgs: true,
    build: (args) => {
      const parsed = splitKey(args)
      if (!parsed || !parsed.rest) return null
      return { tool: 'comment_on_ticket', arguments: { ticketKey: parsed.key, body: parsed.rest } }
    },
  },
  {
    name: 'assign',
    hint: 'RC-14 <person>',
    description: 'Assign a ticket',
    mutates: true,
    requiresArgs: true,
    build: (args) => {
      const parsed = splitKey(args)
      if (!parsed || !parsed.rest) return null
      return { tool: 'update_ticket', arguments: { ticketKey: parsed.key, assignee: parsed.rest } }
    },
  },
  {
    name: 'move',
    hint: 'RC-14 <status>',
    description: 'Change a ticket’s status',
    mutates: true,
    requiresArgs: true,
    build: (args) => {
      const parsed = splitKey(args)
      if (!parsed || !parsed.rest) return null
      return { tool: 'update_ticket', arguments: { ticketKey: parsed.key, status: parsed.rest } }
    },
  },
]

export const SLASH_NAMES: ReadonlySet<string> = new Set(SLASH_COMMANDS.map((c) => c.name))

export interface ParsedSlash {
  command: SlashCommand
  args: string
  call: { tool: ToolName; arguments: Record<string, unknown> } | null
}

/**
 * Parses an input line, or returns null when it is not a slash command.
 *
 * A leading slash that names nothing known is deliberately NOT a command: it
 * falls through to the Copilot, so a message that merely starts with a slash
 * still gets answered instead of erroring.
 */
export function parseSlash(input: string): ParsedSlash | null {
  const match = /^\/([a-z]+)\s*(.*)$/is.exec(input.trim())
  if (!match) return null

  const command = SLASH_COMMANDS.find((entry) => entry.name === match[1].toLowerCase())
  if (!command) return null

  const args = match[2] ?? ''
  return { command, args, call: command.build(args) }
}

/** The commands matching what has been typed so far, for the menu. */
export function matchingCommands(input: string): SlashCommand[] {
  const match = /^\/([a-z]*)$/i.exec(input.trim())
  if (!match) return []
  const prefix = match[1].toLowerCase()
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(prefix))
}
