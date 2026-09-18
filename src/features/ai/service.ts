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
  projectId?: string
  projectName?: string
  projectCode?: string
}

export interface CopilotTurn {
  reply: string
  toolRuns: Array<{ name: string; result: ToolResult }>
}

function buildSystemPrompt(context: CopilotContext): string {
  const today = new Date().toISOString().slice(0, 10)

  /*
   * Kept deliberately short. This is re-sent on every request, and the free
   * Groq tier allows 8,000 tokens per minute — a verbose prompt directly
   * reduces how many messages the user gets before being throttled.
   */
  return [
    'You are the TaskForge Copilot in a ticket management app.',
    `Today ${today}. User: ${context.actor.name} (@${context.actor.username}), ${context.actor.role}.`,
    context.projectId
      ? `Open project: ${context.projectName} (${context.projectCode}). Assume it when none is named.`
      : 'No project open; the user must name one.',
    'Use tools for real data — never invent keys, statuses, names or counts.',
    'Call find_duplicates before creating a ticket; if close matches exist, show them and ask.',
    'For several related tasks, use bulk_create_tickets (one parent + children), not separate tickets.',
    'Be brief and concrete. Refer to tickets by key. No markdown tables or headings — the panel is narrow.',
    'If a tool fails, say what went wrong. Never claim an action a tool did not confirm.',
  ].join('\n')
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
  }
}
