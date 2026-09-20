import { getAiProvider, type AiMessage } from '@/infrastructure/ai'
import { bulkCreateTool, getToolDefinitions } from './tools'

/**
 * Turning notes into a ticket breakdown.
 *
 * A separate path from the Copilot chat, because it is a different job. Chat is
 * a conversation with a small input box and a model free to choose any of six
 * tools; this takes one long lump of text — a meeting note, a chat thread, a
 * stack trace — and has exactly one job, which lets the prompt be far more
 * specific about what a good breakdown looks like.
 *
 * Nothing is written. The result is a proposal the user edits and approves,
 * exactly like a Copilot write.
 */

const MAX_INPUT = 12_000

function buildPrompt(projectCode: string | undefined, today: string): string {
  return [
    'You turn raw notes into a ticket breakdown. The notes may be meeting minutes, a chat transcript, an email, a bug report or a stack trace.',
    `Today is ${today}.${projectCode ? ` The project is ${projectCode}.` : ''}`,
    'Call bulk_create_tickets exactly once. Never call any other tool.',
    // The failure mode worth guarding: a model asked to "break down" text will
    // happily invent the tasks it thinks ought to be there.
    'Only include work that is actually stated or clearly implied in the notes. Do not invent tasks to round the list out.',
    'The parent is the overall piece of work. Children are the individual tasks — one per distinct action.',
    'Titles are short and imperative: "Fix the Safari checkout redirect", not "There is a bug where...".',
    'Put the supporting detail in each description, including any error text or reproduction steps verbatim.',
    'Only set assignee when a person is named as doing that specific task. Only set labels when the notes name a component or area.',
    'If the notes describe a single task rather than several, still produce one parent with one child.',
  ].join('\n')
}

export interface ExtractedBreakdown {
  parentTitle: string
  parentDescription?: string
  children: Array<{
    title: string
    description?: string
    assignee?: string
    labels?: string[]
  }>
}

export type ExtractResult =
  | { ok: true; breakdown: ExtractedBreakdown; rawArguments: Record<string, unknown> }
  | { ok: false; reason: string }

export async function extractBreakdown(
  text: string,
  projectCode?: string,
): Promise<ExtractResult> {
  const trimmed = text.trim()
  if (trimmed.length < 20) {
    return { ok: false, reason: 'Paste a bit more text — there is not enough here to break down.' }
  }

  const provider = getAiProvider()
  const today = new Date().toISOString().slice(0, 10)

  const messages: AiMessage[] = [
    { role: 'system', content: buildPrompt(projectCode, today) },
    { role: 'user', content: trimmed.slice(0, MAX_INPUT) },
  ]

  // Only the one tool is offered. Narrowing the surface is more reliable than
  // instructing a model not to use the others.
  const tools = getToolDefinitions().filter((tool) => tool.name === 'bulk_create_tickets')

  const response = await provider.chat({ messages, tools })
  const call = response.toolCalls.find((entry) => entry.name === 'bulk_create_tickets')

  if (!call) {
    return {
      ok: false,
      reason:
        response.content.trim() ||
        'No tasks could be identified in that text. Try including more detail about what needs doing.',
    }
  }

  // The same validation a Copilot tool call gets. Model output is never trusted
  // just because it came from a narrower prompt.
  const parsed = bulkCreateTool.safeParse(call.arguments)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `The breakdown came back malformed (${parsed.error.issues
        .map((issue) => issue.path.join('.') || 'root')
        .join(', ')}). Try rephrasing the notes.`,
    }
  }

  return {
    ok: true,
    breakdown: {
      parentTitle: parsed.data.parentTitle,
      parentDescription: parsed.data.parentDescription,
      children: parsed.data.children,
    },
    rawArguments: call.arguments,
  }
}
