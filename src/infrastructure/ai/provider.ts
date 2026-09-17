/**
 * AI provider port.
 *
 * One interface, two adapters (Groq and Ollama). Nothing above this layer knows
 * which is in use; swapping providers is an environment variable, not a code
 * change.
 */

export type AiRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AiToolCall {
  id: string
  name: string
  /** Raw arguments from the model. ALWAYS validated before use. */
  arguments: Record<string, unknown>
}

export interface AiMessage {
  role: AiRole
  content: string
  /** Present on assistant turns that requested tools. */
  toolCalls?: AiToolCall[]
  /** Present on tool-result turns, linking back to the call. */
  toolCallId?: string
  name?: string
}

export interface AiToolDefinition {
  name: string
  description: string
  /** JSON Schema, generated from the Zod schema so the two cannot drift. */
  parameters: Record<string, unknown>
}

export interface AiChatRequest {
  messages: AiMessage[]
  tools?: AiToolDefinition[]
  temperature?: number
  maxTokens?: number
}

export interface AiChatResponse {
  content: string
  toolCalls: AiToolCall[]
}

export interface AiProvider {
  readonly id: 'groq' | 'ollama'
  readonly model: string
  chat(request: AiChatRequest): Promise<AiChatResponse>
}

/** Raised when the provider is unreachable or misconfigured. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}
