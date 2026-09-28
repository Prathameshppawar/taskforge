import { env, isAiEnabled } from '@/lib/env'
import { AnthropicProvider } from './anthropic'
import { GroqProvider } from './groq'
import { OpenAiProvider } from './openai'
import { OllamaProvider } from './ollama'
import { AiProviderError, type AiProvider } from './provider'

export * from './provider'

let cached: AiProvider | null = null

/**
 * Resolves the configured provider.
 *
 * Cached per process — constructing the client is cheap but pointless to repeat
 * on every request.
 */
export function getAiProvider(): AiProvider {
  if (cached) return cached

  if (!isAiEnabled()) {
    throw new AiProviderError(
      'The AI Copilot is not configured. Set AI_PROVIDER and the matching credentials.',
      'none',
      'unauthorized',
    )
  }

  cached = env().AI_PROVIDER === 'groq' ? new GroqProvider() : new OllamaProvider()
  return cached
}

export { isAiEnabled }

export type CodingEngineId = 'anthropic' | 'openai' | 'groq'

export interface CodingEngine {
  id: CodingEngineId
  label: string
  model: string
}

/**
 * The engines that can write code for "Fix with AI", most capable first:
 * Anthropic, then OpenAI, then Groq. Only those with a key configured are
 * listed, so the first entry is the default and an empty list means the
 * feature is off.
 *
 * Independent of AI_PROVIDER, which picks the Copilot's model — a workspace can
 * chat on Groq's free tier and still send code changes to a stronger model.
 */
export function listCodingEngines(): CodingEngine[] {
  let config: ReturnType<typeof env>
  try {
    config = env()
  } catch {
    return []
  }
  const engines: CodingEngine[] = []
  if (config.ANTHROPIC_API_KEY) engines.push({ id: 'anthropic', label: 'Anthropic', model: config.ANTHROPIC_MODEL })
  if (config.OPENAI_API_KEY) engines.push({ id: 'openai', label: 'OpenAI', model: config.OPENAI_MODEL })
  if (config.GROQ_API_KEY) engines.push({ id: 'groq', label: 'Groq', model: config.GROQ_MODEL })
  return engines
}

export function getCodingProvider(id: CodingEngineId): AiProvider {
  const config = env()
  switch (id) {
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY) break
      return new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
    case 'openai':
      if (!config.OPENAI_API_KEY) break
      return new OpenAiProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL)
    case 'groq':
      if (!config.GROQ_API_KEY) break
      return new GroqProvider()
  }
  throw new AiProviderError(`The ${id} engine has no API key configured.`, id, 'unauthorized')
}
