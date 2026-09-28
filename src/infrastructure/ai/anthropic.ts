import Anthropic from '@anthropic-ai/sdk'

import {
  AiProviderError,
  type AiChatRequest,
  type AiChatResponse,
  type AiMessage,
  type AiProvider,
  type AiToolCall,
} from './provider'

/**
 * Anthropic adapter.
 *
 * Claude Opus 5 by default, with adaptive thinking: the model decides how much
 * to reason per turn, which is what a multi-step code change wants. Streaming,
 * because a turn that writes a whole file can run long enough to trip a
 * non-streaming timeout; tool input streams eagerly for the same reason, which
 * is why the agent validates every tool input itself rather than trusting it.
 *
 * Server-side refusal fallbacks are on (`fallbacks: "default"`): if Opus 5's
 * safety classifiers decline a turn — a security fix can look like attack code
 * — the API re-runs it on Anthropic's recommended substitute inside the same
 * call instead of returning a refusal.
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

type Block = Anthropic.Beta.BetaContentBlock
type BlockParam = Anthropic.Beta.BetaContentBlockParam

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const
  readonly model: string
  private readonly client: Anthropic

  constructor(apiKey: string, model = 'claude-opus-5') {
    this.model = model
    this.client = new Anthropic({ apiKey })
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')

    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: request.maxTokens ?? 32000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: request.agentic ? 'high' : 'medium' },
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(request.messages),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
                eager_input_streaming: true,
              })),
            }
          : {}),
      })

      const message = await stream.finalMessage()

      if (message.stop_reason === 'refusal') {
        throw new AiProviderError(
          'Claude declined this request, and so did the fallback model.',
          'anthropic',
          'unknown',
        )
      }

      const content = echoable(message.content)
      const toolCalls: AiToolCall[] = content
        .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          name: block.name,
          arguments:
            typeof block.input === 'object' && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {},
        }))

      return {
        content: content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
        toolCalls,
        usage: {
          promptTokens: message.usage.input_tokens,
          completionTokens: message.usage.output_tokens,
          totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        },
        providerState: content,
        truncated: message.stop_reason === 'max_tokens',
      }
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      throw classify(error, this.model)
    }
  }
}

/**
 * The part of a response that may be sent back next turn.
 *
 * After a mid-output fallback, thinking and tool-use blocks produced *before*
 * the last `fallback` boundary belong to the model that declined and must not
 * be echoed; text before it, and everything after it, may. With no fallback
 * this is the content unchanged.
 */
export function echoable(content: Block[]): Block[] {
  const boundary = content.map((block) => block.type).lastIndexOf('fallback')
  if (boundary === -1) return content

  return content.filter((block, index) => {
    if (index > boundary) return true
    return block.type === 'text'
  })
}

/**
 * Neutral messages to Anthropic's shape. System turns travel separately;
 * consecutive tool results collapse into one user turn, as the API requires
 * all results for one assistant turn to arrive together.
 */
function toAnthropicMessages(messages: AiMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'tool') {
      const result: Anthropic.Beta.BetaToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content,
      }
      const last = out[out.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        ;(last.content as BlockParam[]).push(result)
      } else {
        out.push({ role: 'user', content: [result] })
      }
      continue
    }

    if (message.role === 'assistant') {
      // Our own previous turn: replay the exact blocks, thinking included.
      if (Array.isArray(message.providerState)) {
        out.push({ role: 'assistant', content: message.providerState as BlockParam[] })
        continue
      }
      const blocks: BlockParam[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : message.content })
      continue
    }

    out.push({ role: 'user', content: message.content })
  }

  return out
}

function classify(error: unknown, model: string): AiProviderError {
  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get?.('retry-after')
    const wait = header ? Math.ceil(Number(header)) : 30
    return new AiProviderError(
      `Anthropic rate limit reached. Try again in about ${wait} seconds.`,
      'anthropic',
      'rate_limited',
      wait,
      error,
    )
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('Anthropic rejected the API key. Check ANTHROPIC_API_KEY.', 'anthropic', 'unauthorized', undefined, error)
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiProviderError(`The model "${model}" is not available on this Anthropic account.`, 'anthropic', 'model_not_found', undefined, error)
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiProviderError(`Anthropic rejected the request: ${error.message.slice(0, 200)}`, 'anthropic', 'invalid_tool_call', undefined, error)
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError(`Anthropic request failed (${error.status}).`, 'anthropic', 'unreachable', undefined, error)
  }
  return new AiProviderError('Anthropic could not be reached.', 'anthropic', 'unreachable', undefined, error)
}
