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
      throw new AiProviderError('GROQ_API_KEY is not set.', 'groq')
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
      throw new AiProviderError(
        'The AI provider could not be reached. Check GROQ_API_KEY and the model name.',
        'groq',
        error,
      )
    }
  }
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
