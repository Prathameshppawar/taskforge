import { env } from '@/lib/env'
import {
  AiProviderError,
  type AiChatRequest,
  type AiChatResponse,
  type AiProvider,
  type AiToolCall,
} from './provider'

/**
 * Ollama adapter.
 *
 * Talks to the local /api/chat endpoint, which supports tool calling for models
 * that implement it (llama3.1 and later). No SDK is used — it is one fetch, and
 * avoiding the dependency keeps the serverless bundle smaller.
 */
export class OllamaProvider implements AiProvider {
  readonly id = 'ollama' as const
  readonly model: string
  private readonly baseUrl: string

  constructor() {
    const config = env()
    this.model = config.OLLAMA_MODEL
    this.baseUrl = config.OLLAMA_BASE_URL.replace(/\/+$/, '')
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const body = {
      model: this.model,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens ?? env().AI_MAX_TOKENS,
      },
      messages: request.messages.map((message) => {
        if (message.role === 'tool') {
          return { role: 'tool' as const, content: message.content }
        }
        if (message.role === 'assistant' && message.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: message.content,
            tool_calls: message.toolCalls.map((call) => ({
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        }
        return { role: message.role, content: message.content }
      }),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Local models can be slow; give them room but do not hang forever.
        signal: AbortSignal.timeout(120_000),
      })
    } catch (error) {
      throw new AiProviderError(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? (ollama serve)`,
        'ollama',
        error,
      )
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AiProviderError(
        response.status === 404
          ? `The model "${this.model}" is not installed. Run: ollama pull ${this.model}`
          : `Ollama returned ${response.status}. ${detail.slice(0, 200)}`,
        'ollama',
      )
    }

    const payload = (await response.json()) as {
      message?: {
        content?: string
        tool_calls?: Array<{
          function?: { name?: string; arguments?: unknown }
        }>
      }
    }

    const toolCalls: AiToolCall[] = []
    for (const [index, call] of (payload.message?.tool_calls ?? []).entries()) {
      if (!call.function?.name) continue
      toolCalls.push({
        // Ollama does not issue call ids; a stable synthetic one is enough
        // because the conversation is replayed in order.
        id: `ollama-${index}`,
        name: call.function.name,
        arguments: normalizeArguments(call.function.arguments),
      })
    }

    return {
      content: payload.message?.content ?? '',
      toolCalls,
    }
  }
}

/** Ollama may return arguments as an object or a JSON string, depending on the model. */
function normalizeArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return {}
}
