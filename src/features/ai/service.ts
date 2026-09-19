import { AiProviderError, getAiProvider, type AiMessage } from '@/infrastructure/ai'
import type { Actor } from '@/features/auth/guards'
import { executeTool, type ToolResult } from './executor'
import { getToolDefinitions, isToolName } from './tools'

/**
 * Copilot orchestration.
 *
 * A bounded tool-calling loop: the model may call tools, sees their results,
 * and gets to respond. The bound matters — without it a confused model can
 * loop indefinitely, burning tokens and wall-clock on a user-facing request.
 */
const MAX_TOOL_ROUNDS = 4

export interface CopilotContext {
  actor: Actor
  /** Approve writes without asking. Set once the user has confirmed. */
  autoApprove?: boolean
  projectId?: string
  projectName?: string
  projectCode?: string
  screen?: {
    view: string
    filters?: string
    openTicket?: { key: string; title: string; status: string }
  }
}

export interface CopilotTurn {
  reply: string
  toolRuns: Array<{ name: string; result: ToolResult }>
  /** Writes awaiting the user's approval. Empty when nothing was proposed. */
  proposals: Array<{ tool: string; arguments: Record<string, unknown>; label: string }>
}

/**
 * Exported so the eval suite grades the prompt the app actually ships. A copy
 * kept in the test fixtures would drift, and an eval that passes against a
 * prompt nobody uses is worse than no eval at all.
 */
export function buildSystemPrompt(context: CopilotContext): string {
  const today = new Date().toISOString().slice(0, 10)

  /*
   * Kept deliberately short. This is re-sent on every request, and the free
   * Groq tier allows 8,000 tokens per minute — a verbose prompt directly
   * reduces how many messages the user gets before being throttled.
   */
  return [
    'You are the TaskForge Copilot in a ticket management app.',
    `Today ${today}. User: ${context.actor.name} (@${context.actor.username}), ${context.actor.roleName}.`,
    context.projectId
      ? `Open project: ${context.projectName} (${context.projectCode}). Assume it when none is named.`
      : 'No project open; the user must name one.',
    'Use tools for real data — never invent keys, statuses, names or counts.',
    'Call find_duplicates before creating a ticket; if close matches exist, show them and ask.',
    'For several related tasks, use bulk_create_tickets (one parent + children), not separate tickets.',
    // A project can have a status and a label of the same name — "Testing" is
    // both in some workspaces — so state which one a move refers to.
    '"move/put X to Y" or "mark X as Y" changes STATUS. Only use addLabels when the user says label or tag.',
    'Be brief and concrete. Refer to tickets by key. No markdown tables or headings — the panel is narrow.',
    'If a tool fails, say what went wrong. Never claim an action a tool did not confirm.',
    // The proposal card already lists every field, so repeating them in prose
    // duplicates the screen and spends output tokens saying it twice.
    'A tool that returns "Proposed:" has NOT run. The user already sees the full details in a card, so reply with ONE short sentence asking them to confirm. Do not list the fields again, and never say it is done.',
    // Screen context last, so it reads as the immediate situation.
    ...screenLines(context),
  ].join('\n')
}

/**
 * Describes what the user is looking at.
 *
 * This is what makes "assign this to me" or "how many of these are blocked"
 * answerable — without it the model has no referent for "this" and has to ask.
 * Kept to a couple of lines because it is re-sent on every request.
 */
function screenLines(context: CopilotContext): string[] {
  const screen = context.screen
  if (!screen) return []

  const lines: string[] = []

  if (screen.openTicket) {
    lines.push(
      `On screen: ticket ${screen.openTicket.key} "${screen.openTicket.title}" (${screen.openTicket.status}). "this ticket" means ${screen.openTicket.key}.`,
    )
  } else {
    lines.push(`On screen: the ${screen.view} view.`)
  }

  if (screen.filters) {
    lines.push(`Active filters: ${screen.filters}. "these"/"shown" means tickets matching them.`)
  }

  return lines
}

/** Retries once on a rate limit, since the free tier throttles per minute. */
async function chatWithRetry(
  provider: ReturnType<typeof getAiProvider>,
  request: Parameters<ReturnType<typeof getAiProvider>['chat']>[0],
) {
  try {
    return await provider.chat(request)
  } catch (error) {
    const isRateLimit =
      error instanceof AiProviderError && error.kind === 'rate_limited'

    // Only wait if the window is short enough that the user is still there.
    if (!isRateLimit || (error.retryAfterSeconds ?? 99) > 12) throw error

    await new Promise((resolve) =>
      setTimeout(resolve, ((error as AiProviderError).retryAfterSeconds ?? 5) * 1000 + 500),
    )
    return provider.chat(request)
  }
}

export async function runCopilotTurn(
  context: CopilotContext,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
): Promise<CopilotTurn> {
  const provider = getAiProvider()
  const tools = getToolDefinitions()

  const messages: AiMessage[] = [
    { role: 'system', content: buildSystemPrompt(context) },
    // Only the last few turns are replayed: the panel is a task assistant, not
    // a long-running chat, and a shorter window keeps latency and cost down.
    ...history.slice(-6).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: userMessage },
  ]

  const toolRuns: CopilotTurn['toolRuns'] = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatWithRetry(provider, { messages, tools })

    if (response.toolCalls.length === 0) {
      return {
        reply: response.content.trim() || 'Done.',
        toolRuns,
        proposals: collectProposals(toolRuns),
      }
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    })

    for (const call of response.toolCalls) {
      if (!isToolName(call.name)) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: `Unknown tool "${call.name}".`,
        })
        continue
      }

      let result: ToolResult
      try {
        result = await executeTool(call.name, call.arguments, {
          actor: context.actor,
          currentProjectId: context.projectId,
          propose: !context.autoApprove,
        })
      } catch (error) {
        // A thrown guard (ForbiddenError, NotFoundError) is reported back to
        // the model as a tool failure so it can explain rather than crash.
        result = {
          ok: false,
          summary:
            error instanceof Error ? error.message : 'The tool failed unexpectedly.',
        }
      }

      toolRuns.push({ name: call.name, result })

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: result.summary,
      })
    }
  }

  // The loop bound was hit — report honestly rather than pretending to finish.
  const lastRun = toolRuns[toolRuns.length - 1]
  return {
    reply:
      lastRun?.result.summary ??
      'I could not complete that in a reasonable number of steps. Try narrowing the request.',
    toolRuns,
    proposals: collectProposals(toolRuns),
  }
}

function collectProposals(runs: CopilotTurn['toolRuns']): CopilotTurn['proposals'] {
  return runs
    .map((run) => run.result.proposal)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ tool: p.tool, arguments: p.arguments, label: p.label }))
}
