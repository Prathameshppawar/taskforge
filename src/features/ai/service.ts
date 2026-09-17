import { getAiProvider, type AiMessage } from '@/infrastructure/ai'
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

  return [
    'You are the TaskForge Copilot, an assistant inside an internal project and ticket management platform.',
    '',
    `Today is ${today}. The signed-in user is ${context.actor.name} (@${context.actor.username}), role ${context.actor.role}.`,
    context.projectId
      ? `They currently have the project "${context.projectName}" (${context.projectCode}) open. When they do not name a project, assume this one.`
      : 'No project is currently open, so the user must name a project for anything project-specific.',
    '',
    'How to behave:',
    '- Use the tools for anything involving real data. Never invent ticket keys, statuses, names or counts.',
    '- Before creating a ticket, call find_duplicates first. If close matches exist, show them and ask whether to continue instead of creating straight away.',
    '- When the user describes several related tasks, or asks to break work down, use bulk_create_tickets to make one parent feature with its child tasks — do not create a flat list of unrelated tickets.',
    '- For questions about what exists ("show blocked tickets", "my critical bugs"), use search_tickets.',
    '- For "how is the project doing", use project_insights and interpret the numbers: say what stands out, not just the figures.',
    '',
    'How to write:',
    '- Be brief and concrete. A sentence or two is usually right.',
    '- Refer to tickets by key, e.g. ATLAS-14.',
    '- Do not use markdown tables or headings; the panel is narrow. Short lines and plain prose only.',
    '- If a tool fails, say plainly what went wrong and what the user could try instead.',
    '- Never claim to have done something a tool did not confirm.',
  ].join('\n')
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
    const response = await provider.chat({ messages, tools })

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
