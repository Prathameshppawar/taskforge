import OpenAI from 'openai'

import {
  AiProviderError,
  type AiChatRequest,
  type AiChatResponse,
  type AiProvider,
  type AiToolCall,
} from './provider'

/**
 * OpenAI adapter, over Chat Completions with native tool calling — the same
 * shape the Groq adapter speaks, which keeps the two easy to compare.
 *
 * No `temperature`: OpenAI's reasoning models accept only the default and
 * reject anything else, so sending one is a request that fails for some models
 * and does nothing for the rest. `max_completion_tokens` rather than
 * `max_tokens` for the same family of reasons.
 */
export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const
  readonly model: string
  private readonly client: OpenAI

  constructor(apiKey: string, model: string) {
    this.model = model
    this.client = new OpenAI({ apiKey })
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: request.maxTokens ?? 16000,
        messages: request.messages.map((message): OpenAI.Chat.ChatCompletionMessageParam => {
          if (message.role === 'tool') {
            return { role: 'tool', content: message.content, tool_call_id: message.toolCallId ?? '' }
          }
          if (message.role === 'assistant' && message.toolCalls?.length) {
            return {
              role: 'assistant',
              content: message.content || null,
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          }
          if (message.role === 'system') return { role: 'system', content: message.content }
          if (message.role === 'assistant') return { role: 'assistant', content: message.content }
          return { role: 'user', content: message.content }
        }),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function' as const,
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
              tool_choice: 'auto' as const,
            }
          : {}),
      })

      const choice = completion.choices[0]
      const toolCalls: AiToolCall[] = []
      for (const call of choice?.message?.tool_calls ?? []) {
        if (call.type !== 'function') continue
        toolCalls.push({ id: call.id, name: call.function.name, arguments: parseArguments(call.function.arguments) })
      }

      return {
        content: choice?.message?.content ?? '',
        toolCalls,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
        truncated: choice?.finish_reason === 'length',
      }
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      throw classify(error, this.model)
    }
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function classify(error: unknown, model: string): AiProviderError {
  if (error instanceof OpenAI.RateLimitError) {
    return new AiProviderError('OpenAI rate limit reached. Try again shortly.', 'openai', 'rate_limited', 30, error)
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new AiProviderError('OpenAI rejected the API key. Check OPENAI_API_KEY.', 'openai', 'unauthorized', undefined, error)
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new AiProviderError(`The model "${model}" is not available. Set OPENAI_MODEL to one your account can use.`, 'openai', 'model_not_found', undefined, error)
  }
  if (error instanceof OpenAI.APIError) {
    return new AiProviderError(`OpenAI request failed (${error.status}): ${error.message.slice(0, 160)}`, 'openai', 'unreachable', undefined, error)
  }
  return new AiProviderError('OpenAI could not be reached.', 'openai', 'unreachable', undefined, error)
}
