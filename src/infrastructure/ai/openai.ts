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
  readonly id: string
  readonly model: string
  private readonly label: string
  private readonly client: OpenAI

  /**
   * With `baseURL`, any OpenAI-compatible provider — Gemini, DeepSeek, Zhipu,
   * Qwen, OpenRouter… — through the same client. `id` then names that engine
   * in the usage ledger, and `label` in its error messages.
   */
  constructor(apiKey: string, model: string, options: { id?: string; label?: string; baseURL?: string } = {}) {
    this.id = options.id ?? 'openai'
    this.label = options.label ?? 'OpenAI'
    this.model = model
    this.client = new OpenAI({ apiKey, ...(options.baseURL ? { baseURL: options.baseURL } : {}) })
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
      throw classify(error, this.model, this.id, this.label)
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

function classify(error: unknown, model: string, id: string, label: string): AiProviderError {
  if (error instanceof OpenAI.RateLimitError) {
    // Free tiers mostly fail here; honour the provider's retry-after when given.
    const header = error.headers?.get?.('retry-after')
    const wait = header && Number.isFinite(Number(header)) ? Math.ceil(Number(header)) : 30
    return new AiProviderError(`${label} rate limit reached. Try again in about ${wait} seconds.`, id, 'rate_limited', wait, error)
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new AiProviderError(`${label} rejected the API key. Check it on Workspace → AI.`, id, 'unauthorized', undefined, error)
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new AiProviderError(`The model "${model}" is not available on ${label}. Choose another on Workspace → AI.`, id, 'model_not_found', undefined, error)
  }
  if (error instanceof OpenAI.BadRequestError && /tool|function/i.test(error.message)) {
    return new AiProviderError(`${label} rejected a tool call: ${error.message.slice(0, 160)}`, id, 'invalid_tool_call', undefined, error)
  }
  if (error instanceof OpenAI.APIError) {
    return new AiProviderError(`${label} request failed (${error.status}): ${error.message.slice(0, 160)}`, id, 'unreachable', undefined, error)
  }
  return new AiProviderError(`${label} could not be reached.`, id, 'unreachable', undefined, error)
}
