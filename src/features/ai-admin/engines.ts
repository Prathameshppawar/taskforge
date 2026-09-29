import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

import { prisma } from '@/infrastructure/db/prisma'
import { env } from '@/lib/env'
import { seal, unseal } from '@/infrastructure/github/secrets'
import { AiProviderError, type AiProvider, type CodingEngineId } from '@/infrastructure/ai'
import { AnthropicProvider } from '@/infrastructure/ai/anthropic'
import { OpenAiProvider } from '@/infrastructure/ai/openai'
import { GroqProvider } from '@/infrastructure/ai/groq'
import { OllamaProvider } from '@/infrastructure/ai/ollama'
import { ENGINE_CATALOG, engineDefinition, type EngineDefinition } from '@/core/domain/engine-catalog'
import { checkMonitorUrl } from '@/core/domain/network'

/**
 * Which AI engines the workspace can use, with which model and which key.
 *
 * The engines themselves are declared in the engine catalogue; this file joins
 * them with what the workspace has saved. Settings saved on the AI page win
 * over the environment, so an administrator can connect a provider or switch
 * model without a redeploy; with nothing saved, the environment behaves as it
 * always did.
 */

export interface ResolvedEngine {
  id: CodingEngineId
  label: string
  model: string
  enabled: boolean
  /** Where the key came from, or null when there is none. */
  keySource: 'settings' | 'env' | null
  keyHint: string | null
  /** How the workspace pays: free tier, list price, or its own rate. */
  billingPlan: 'free' | 'list' | 'custom'
  /** OpenAI-compatible engines: where requests go. Only the custom engine's is editable. */
  baseUrl: string | null
  definition: EngineDefinition
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

  return ENGINE_CATALOG.map((definition) => {
    const row = byId.get(definition.id)
    const envKey = (definition.envKey && config?.[definition.envKey]) || null

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
      definition.id === 'anthropic'
        ? config?.ANTHROPIC_MODEL
        : definition.id === 'openai'
          ? config?.OPENAI_MODEL
          : definition.id === 'groq'
            ? config?.GROQ_MODEL
            : undefined

    return {
      id: definition.id,
      label: definition.label,
      model: row?.model || envModel || definition.defaultModel,
      enabled: row?.enabled ?? true,
      keySource: storedKey ? 'settings' : envKey ? 'env' : null,
      keyHint: storedKey ? row!.keyHint : envKey ? envKey.slice(-4) : null,
      // A provider with a permanent free tier starts on it: that is how it is
      // almost always first used, and it keeps spend honest at $0.
      billingPlan: (row?.billingPlan as ResolvedEngine['billingPlan'] | undefined) ?? (definition.freeTier === 'permanent' ? 'free' : 'list'),
      baseUrl: definition.id === 'custom' ? (row?.baseUrl ?? null) : (definition.baseUrl ?? null),
      definition,
      apiKey: storedKey ?? envKey,
    }
  })
}

/** Usable: switched on, holding a key, and — for the custom engine — pointed somewhere. */
function usable(engine: EngineWithKey): boolean {
  return engine.enabled && Boolean(engine.apiKey) && Boolean(engine.model) && (engine.id !== 'custom' || Boolean(engine.baseUrl))
}

const strip = ({ apiKey: _apiKey, ...engine }: EngineWithKey): ResolvedEngine => engine

/** Every engine, configured or not — for the settings page. */
export async function listEngines(): Promise<ResolvedEngine[]> {
  return (await loadEngines()).map(strip)
}

/**
 * Engines that can do work: usable, ordered with the workspace's chosen
 * default first and then most capable first.
 */
export async function listCodingEngines(): Promise<ResolvedEngine[]> {
  const [engines, workspace] = await Promise.all([loadEngines(), getWorkspaceSetting()])
  const ready = engines.filter(usable).sort((a, b) => a.definition.rank - b.definition.rank).map(strip)
  const preferred = workspace.fixProvider
  return preferred ? [...ready.filter((e) => e.id === preferred), ...ready.filter((e) => e.id !== preferred)] : ready
}

/**
 * A provider for one engine. `model` overrides the engine's own: an agent may
 * use a different model of the same provider, and a run that recorded which
 * model it was started with must run on exactly that one.
 */
export async function getEngineProvider(id: CodingEngineId, model?: string): Promise<AiProvider> {
  const engine = (await loadEngines()).find((candidate) => candidate.id === id)
  if (!engine || !usable(engine)) {
    throw new AiProviderError(`The ${engine?.label ?? id} engine is not configured or is switched off.`, id, 'unauthorized')
  }
  const key = engine.apiKey!
  const chosen = model || engine.model
  switch (engine.definition.adapter) {
    case 'anthropic':
      return new AnthropicProvider(key, chosen)
    case 'openai':
      return new OpenAiProvider(key, chosen)
    case 'groq':
      return new GroqProvider(chosen, key)
    case 'openai-compatible':
      return new OpenAiProvider(key, chosen, { id: engine.id, label: engine.label, baseURL: engine.baseUrl! })
  }
}

/**
 * The engine and model an agent works with: its own assignment when that
 * engine is usable, otherwise the workspace default — the Copilot's choice for
 * the Copilot, the first ready engine for everyone else. Null when nothing is
 * configured at all.
 */
export async function agentEngine(role: string): Promise<{ id: CodingEngineId; label: string; model: string; assigned: boolean } | null> {
  const [setting, ready] = await Promise.all([prisma.agentSetting.findUnique({ where: { agent: role } }), listCodingEngines()])
  const own = setting ? ready.find((engine) => engine.id === setting.engineId) : undefined
  if (own && setting) return { id: own.id, label: own.label, model: setting.model, assigned: true }
  if (role === 'copilot') {
    const workspace = await getWorkspaceSetting()
    const chosen = ready.find((engine) => engine.id === workspace.copilotProvider) ?? ready.find((engine) => engine.id === 'groq') ?? ready[0]
    return chosen ? { id: chosen.id, label: chosen.label, model: chosen.model, assigned: false } : null
  }
  const first = ready[0]
  return first ? { id: first.id, label: first.label, model: first.model, assigned: false } : null
}

export async function agentProvider(role: string): Promise<AiProvider> {
  const engine = await agentEngine(role)
  if (!engine) throw new AiProviderError('No AI engine is configured. Connect one on Workspace → AI.', 'none', 'unauthorized')
  return getEngineProvider(engine.id, engine.model)
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
  // The Copilot's own assignment first, when it has one that works.
  const own = await prisma.agentSetting.findUnique({ where: { agent: 'copilot' } })
  if (own) {
    try {
      return await getEngineProvider(own.engineId, own.model)
    } catch {
      // Assigned engine switched off or lost its key: fall back below.
    }
  }
  const workspace = await getWorkspaceSetting()
  const chosen = workspace.copilotProvider

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
  billingPlan: 'free' | 'list' | 'custom'
  /** Undefined leaves the stored key alone; null removes it. */
  apiKey?: string | null
  /** Custom engine only. */
  baseUrl?: string | null
}) {
  if (!engineDefinition(input.id)) throw new Error(`Unknown engine "${input.id}".`)

  let baseUrl: string | null | undefined
  if (input.id === 'custom' && input.baseUrl !== undefined) {
    if (input.baseUrl) {
      // The server will send code and tickets to this address, so it gets the
      // same public-host rule as an uptime monitor, and must be https.
      const checked = checkMonitorUrl(input.baseUrl)
      if (!checked.ok) throw new Error(checked.reason)
      if (checked.url.protocol !== 'https:') throw new Error('Use an https:// endpoint.')
      baseUrl = checked.url.toString().replace(/\/+$/, '')
    } else {
      baseUrl = null
    }
  }

  const keyData =
    input.apiKey === undefined
      ? {}
      : input.apiKey === null
        ? { apiKeyEnc: null, keyHint: null }
        : { apiKeyEnc: seal(input.apiKey), keyHint: input.apiKey.slice(-4) }
  const fields = {
    model: input.model,
    enabled: input.enabled,
    billingPlan: input.billingPlan,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...keyData,
  }

  await prisma.aiEngineSetting.upsert({
    where: { provider: input.id },
    create: { provider: input.id, ...fields },
    update: fields,
  })
}

// -----------------------------------------------------------------------------
// Models on offer
// -----------------------------------------------------------------------------

/** Not chat models, whatever a provider's /models endpoint lists alongside them. */
const NOT_CHAT = /(embed|whisper|tts|speech|audio|transcri|realtime|image|dall|vision-preview|guard|safeguard|moderation|rerank|orpheus|search)/i

/**
 * Chat models the key can actually use, asked of the provider itself so the
 * list never goes stale. Speech, embedding, moderation, reranking and
 * tiny-context models are dropped. Falls back to the catalogue's suggestions
 * when there is no key yet or the provider does not answer.
 */
export async function listAvailableModels(id: CodingEngineId): Promise<{ models: string[]; live: boolean }> {
  const engine = (await loadEngines()).find((candidate) => candidate.id === id)
  const suggested = engine?.definition.suggestedModels ?? []
  const fallback = () => ({ models: engine?.model && !suggested.includes(engine.model) ? [engine.model, ...suggested] : suggested, live: false })
  if (!engine || !usable({ ...engine, enabled: true, model: engine.model || 'x' })) return fallback()

  try {
    let ids: string[] = []
    if (engine.definition.adapter === 'anthropic') {
      const client = new Anthropic({ apiKey: engine.apiKey! })
      for await (const model of client.models.list()) ids.push(model.id)
    } else if (engine.definition.adapter === 'openai') {
      const client = new OpenAI({ apiKey: engine.apiKey! })
      for await (const model of client.models.list()) ids.push(model.id)
      ids = ids.filter((model) => /^(gpt|o\d)/.test(model))
    } else {
      const base = engine.definition.adapter === 'groq' ? 'https://api.groq.com/openai/v1' : engine.baseUrl!
      const response = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${engine.apiKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return fallback()
      const body = (await response.json()) as { data?: Array<{ id: string; context_window?: number; active?: boolean }> }
      ids = (body.data ?? [])
        .filter((model) => model.active !== false && (model.context_window === undefined || model.context_window >= 32_000))
        .map((model) => model.id.replace(/^models\//, '')) // Gemini lists "models/gemini-…"
    }
    ids = ids.filter((model) => !NOT_CHAT.test(model))

    const live = [...new Set(ids)].sort()
    // Suggested first when present, then the rest; the saved model is always
    // listed even if the provider has since stopped reporting it.
    const ordered = [...suggested.filter((model) => live.includes(model)), ...live.filter((model) => !suggested.includes(model))]
    if (engine.model && !ordered.includes(engine.model)) ordered.unshift(engine.model)
    return { models: ordered, live: live.length > 0 }
  } catch {
    return fallback()
  }
}
