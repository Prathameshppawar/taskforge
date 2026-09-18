import Groq from 'groq-sdk'

import { env } from '@/lib/env'
import {
  AiProviderError,
  type AiChatRequest,
  type AiChatResponse,
  type AiProvider,
  type AiToolCall,
} from './provider'

/**
 * Groq adapter.
 *
 * Groq exposes an OpenAI-compatible chat completions API with native tool
 * calling, which is what the Copilot relies on.
 */
export class GroqProvider implements AiProvider {
  readonly id = 'groq' as const
  readonly model: string
  private readonly client: Groq

  constructor() {
    const config = env()
    if (!config.GROQ_API_KEY) {
      throw new AiProviderError('GROQ_API_KEY is not set.', 'groq', 'unauthorized')
    }

    this.model = config.GROQ_MODEL
    this.client = new Groq({ apiKey: config.GROQ_API_KEY })
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? env().AI_MAX_TOKENS,
        messages: request.messages.map((message) => {
          if (message.role === 'tool') {
            return {
              role: 'tool' as const,
              content: message.content,
              tool_call_id: message.toolCallId ?? '',
            }
          }

          if (message.role === 'assistant' && message.toolCalls?.length) {
            return {
              role: 'assistant' as const,
              content: message.content || null,
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            }
          }

          return {
            role: message.role as 'system' | 'user' | 'assistant',
            content: message.content,
          }
        }),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function' as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: 'auto' as const,
            }
          : {}),
      })

      const choice = completion.choices[0]
      const toolCalls: AiToolCall[] = []

      for (const call of choice?.message?.tool_calls ?? []) {
        if (call.type !== 'function') continue
        toolCalls.push({
          id: call.id,
          name: call.function.name,
          arguments: safeParseArguments(call.function.arguments),
        })
      }

      return {
        content: choice?.message?.content ?? '',
        toolCalls,
      }
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      throw classifyGroqError(error, this.model)
    }
  }
}

/**
 * Turns a provider failure into something actionable.
 *
 * Groq's free tier allows 8,000 tokens per minute, which a couple of
 * tool-calling turns can reach. That is by far the most common failure, and it
 * is temporary — so it must not be reported as a credential problem.
 */
function classifyGroqError(error: unknown, model: string): AiProviderError {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : undefined

  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : ''

  if (status === 429) {
    // Groq reports the wait in the message, e.g. "Please try again in 7.2s".
    const match = /try again in ([\d.]+)s/i.exec(raw)
    const wait = match ? Math.ceil(Number(match[1])) : 30
    return new AiProviderError(
      `Rate limit reached — Groq's free tier allows 8,000 tokens per minute. Try again in about ${wait} second${wait === 1 ? '' : 's'}.`,
      'groq',
      'rate_limited',
      wait,
      error,
    )
  }

  if (status === 400 && /tool call validation|did not match schema/i.test(raw)) {
    return new AiProviderError(
      'The model produced an invalid tool call and Groq rejected it. Rephrasing the request usually clears it.',
      'groq',
      'invalid_tool_call',
      undefined,
      error,
    )
  }

  if (status === 401 || status === 403) {
    return new AiProviderError(
      'Groq rejected the API key. Check GROQ_API_KEY.',
      'groq',
      'unauthorized',
      undefined,
      error,
    )
  }

  if (status === 404 || /model/i.test(raw) && /not (found|exist)|decommission/i.test(raw)) {
    return new AiProviderError(
      `The model "${model}" is not available. Groq retires models periodically — list the current ones at https://api.groq.com/openai/v1/models and update GROQ_MODEL.`,
      'groq',
      'model_not_found',
      undefined,
      error,
    )
  }

  return new AiProviderError(
    raw ? `Groq request failed: ${raw.slice(0, 160)}` : 'Groq could not be reached.',
    'groq',
    'unreachable',
    undefined,
    error,
  )
}

/**
 * Models occasionally emit malformed JSON for arguments. An empty object is
 * returned rather than throwing, so schema validation produces a helpful
 * field-level error instead of a crash.
 */
function safeParseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
