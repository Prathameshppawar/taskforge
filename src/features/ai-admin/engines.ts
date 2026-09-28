import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

import { prisma } from '@/infrastructure/db/prisma'
import { env } from '@/lib/env'
import { seal, unseal } from '@/infrastructure/github/secrets'
import {
  AiProviderError,
  type AiProvider,
  type CodingEngineId,
} from '@/infrastructure/ai'
import { AnthropicProvider } from '@/infrastructure/ai/anthropic'
import { OpenAiProvider } from '@/infrastructure/ai/openai'
import { GroqProvider } from '@/infrastructure/ai/groq'
import { OllamaProvider } from '@/infrastructure/ai/ollama'

/**
 * Which AI engines the workspace can use, with which model and which key.
 *
 * Settings saved on the AI page win over the environment, so an administrator
 * can connect a provider or switch model without a redeploy; with nothing
 * saved, the environment behaves exactly as it did before this page existed.
 */

export const ENGINE_IDS: readonly CodingEngineId[] = ['anthropic', 'openai', 'groq']

export const ENGINE_META: Record<
  CodingEngineId,
  { label: string; defaultModel: string; envKey: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'GROQ_API_KEY'; keysUrl: string }
> = {
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-opus-5',
    envKey: 'ANTHROPIC_API_KEY',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-5',
    envKey: 'OPENAI_API_KEY',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
  groq: {
    label: 'Groq',
    defaultModel: 'openai/gpt-oss-120b',
    envKey: 'GROQ_API_KEY',
    keysUrl: 'https://console.groq.com/keys',
  },
}

export interface ResolvedEngine {
  id: CodingEngineId
  label: string
  model: string
  enabled: boolean
  /** Where the key came from, or null when there is none. */
  keySource: 'settings' | 'env' | null
  keyHint: string | null
}

interface EngineWithKey extends ResolvedEngine {
  apiKey: string | null
}

async function loadEngines(): Promise<EngineWithKey[]> {
  const rows = await prisma.aiEngineSetting.findMany()
  const byId = new Map(rows.map((row) => [row.provider, row]))
  let config: ReturnType<typeof env> | null = null
  try {
    config = env()
  } catch {
    config = null
  }

  return ENGINE_IDS.map((id) => {
    const meta = ENGINE_META[id]
    const row = byId.get(id)
    const envKey = config?.[meta.envKey] || null

    let storedKey: string | null = null
    if (row?.apiKeyEnc) {
      try {
        storedKey = unseal(row.apiKeyEnc)
      } catch {
        // AUTH_SECRET changed since it was saved; fall back to the environment.
        storedKey = null
      }
    }

    const envModel =
      id === 'anthropic' ? config?.ANTHROPIC_MODEL : id === 'openai' ? config?.OPENAI_MODEL : config?.GROQ_MODEL
    const apiKey = storedKey ?? envKey

    return {
      id,
      label: meta.label,
      model: row?.model || envModel || meta.defaultModel,
      enabled: row?.enabled ?? true,
      keySource: storedKey ? 'settings' : envKey ? 'env' : null,
      keyHint: storedKey ? row!.keyHint : envKey ? envKey.slice(-4) : null,
      apiKey,
    }
  })
}

/** Every engine, configured or not — for the settings page. */
export async function listEngines(): Promise<ResolvedEngine[]> {
  return (await loadEngines()).map(({ apiKey: _apiKey, ...engine }) => engine)
}

/**
 * Engines that can write code for "Fix with AI": enabled and holding a key.
 * Ordered with the workspace's chosen default first, then most capable first.
 */
export async function listCodingEngines(): Promise<ResolvedEngine[]> {
  const [engines, workspace] = await Promise.all([loadEngines(), getWorkspaceSetting()])
  const usable = engines.filter((engine) => engine.enabled && engine.apiKey).map(({ apiKey: _k, ...e }) => e)
  const preferred = workspace.fixProvider
  return preferred
    ? [...usable.filter((e) => e.id === preferred), ...usable.filter((e) => e.id !== preferred)]
    : usable
}

export async function getEngineProvider(id: CodingEngineId): Promise<AiProvider> {
  const engine = (await loadEngines()).find((candidate) => candidate.id === id)
  if (!engine?.apiKey || !engine.enabled) {
    throw new AiProviderError(`The ${id} engine is not configured or is switched off.`, id, 'unauthorized')
  }
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(engine.apiKey, engine.model)
    case 'openai':
      return new OpenAiProvider(engine.apiKey, engine.model)
    case 'groq':
      return new GroqProvider(engine.model, engine.apiKey)
  }
}

export async function getWorkspaceSetting() {
  return (
    (await prisma.aiWorkspaceSetting.findUnique({ where: { id: 1 } })) ?? {
      id: 1,
      copilotProvider: null,
      fixProvider: null,
      updatedAt: new Date(0),
    }
  )
}

/**
 * The provider for the Copilot and the other conversational features. The AI
 * page's choice first; otherwise the environment's AI_PROVIDER, as before.
 */
export async function resolveCopilotProvider(): Promise<AiProvider> {
  const workspace = await getWorkspaceSetting()
  const chosen = workspace.copilotProvider as CodingEngineId | 'ollama' | null

  if (chosen && chosen !== 'ollama') return getEngineProvider(chosen)

  const config = env()
  if (chosen === 'ollama' || config.AI_PROVIDER === 'ollama') return new OllamaProvider()
  if (config.AI_PROVIDER === 'groq') return getEngineProvider('groq')

  throw new AiProviderError(
    'The AI Copilot is not configured. Choose an engine on Workspace → AI, or set AI_PROVIDER.',
    'none',
    'unauthorized',
  )
}

/** Whether any conversational engine is available, without constructing one. */
export async function isCopilotAvailable(): Promise<boolean> {
  try {
    await resolveCopilotProvider()
    return true
  } catch {
    return false
  }
}

// -----------------------------------------------------------------------------
// Saving
// -----------------------------------------------------------------------------

export async function saveEngine(input: {
  id: CodingEngineId
  model: string
  enabled: boolean
  /** Undefined leaves the stored key alone; null removes it. */
  apiKey?: string | null
}) {
  const keyData =
    input.apiKey === undefined
      ? {}
      : input.apiKey === null
        ? { apiKeyEnc: null, keyHint: null }
        : { apiKeyEnc: seal(input.apiKey), keyHint: input.apiKey.slice(-4) }

  await prisma.aiEngineSetting.upsert({
    where: { provider: input.id },
    create: { provider: input.id, model: input.model, enabled: input.enabled, ...keyData },
    update: { model: input.model, enabled: input.enabled, ...keyData },
  })
}

// -----------------------------------------------------------------------------
// Models on offer
// -----------------------------------------------------------------------------

/**
 * Known-good choices per provider, shown first and used when the provider's
 * own model list cannot be fetched (no key yet, or the call failed).
 */
export const SUGGESTED_MODELS: Record<CodingEngineId, string[]> = {
  anthropic: ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'gpt-5-mini'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
}

/**
 * Chat models the key can actually use, asked of the provider itself so the
 * list never goes stale. Filtered to what can hold a conversation with tools:
 * speech, embedding, moderation and tiny-context models are dropped.
 */
export async function listAvailableModels(id: CodingEngineId): Promise<{ models: string[]; live: boolean }> {
  const engine = (await loadEngines()).find((candidate) => candidate.id === id)
  const suggested = SUGGESTED_MODELS[id]
  if (!engine?.apiKey) return { models: suggested, live: false }

  try {
    let ids: string[] = []
    if (id === 'anthropic') {
      const client = new Anthropic({ apiKey: engine.apiKey })
      for await (const model of client.models.list()) ids.push(model.id)
    } else if (id === 'openai') {
      const client = new OpenAI({ apiKey: engine.apiKey })
      for await (const model of client.models.list()) ids.push(model.id)
      ids = ids.filter((model) => /^(gpt|o\d)/.test(model) && !/(audio|realtime|tts|transcribe|image|search|embedding|moderation)/.test(model))
    } else {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${engine.apiKey}` },
        cache: 'no-store',
      })
      const body = (await response.json()) as { data: Array<{ id: string; context_window?: number; active?: boolean }> }
      ids = body.data
        .filter((model) => model.active !== false && (model.context_window ?? 0) >= 32_000)
        .filter((model) => !/(whisper|guard|safeguard|orpheus|tts)/i.test(model.id))
        .map((model) => model.id)
    }

    const live = [...new Set(ids)].sort()
    // Suggested first when present, then the rest; the saved model is always
    // listed even if the provider has since stopped reporting it.
    const ordered = [...suggested.filter((model) => live.includes(model)), ...live.filter((model) => !suggested.includes(model))]
    if (!ordered.includes(engine.model)) ordered.unshift(engine.model)
    return { models: ordered, live: true }
  } catch {
    return { models: suggested.includes(engine.model) ? suggested : [engine.model, ...suggested], live: false }
  }
}
