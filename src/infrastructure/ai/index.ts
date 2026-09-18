import { env, isAiEnabled } from '@/lib/env'
import { GroqProvider } from './groq'
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
