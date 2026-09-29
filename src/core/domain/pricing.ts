/**
 * List prices from the public model catalogue LiteLLM maintains
 * (model_prices_and_context_window.json) — the most widely used open source of
 * per-token prices. It covers most engines in the engine catalogue; which
 * LiteLLM provider name maps to which engine is declared there.
 *
 * Parsed defensively: it is a third-party file fetched over the network, so
 * anything that is not a finite, non-negative price is ignored rather than
 * trusted, and an implausible one — over $1,000 per million tokens — is
 * treated as a mistake in the file, not a price to bill against.
 */

export interface CatalogPrice {
  /** The TaskForge engine id, e.g. "zhipu" for LiteLLM's "zai". */
  provider: string
  model: string
  inputPerMTok: number
  outputPerMTok: number
  /** Capability facts; null where the catalogue does not say (unknown, not false). */
  supportsTools: boolean | null
  supportsReasoning: boolean | null
  supportsVision: boolean | null
  contextTokens: number | null
}

/** LiteLLM provider name → the engine it prices, and that provider's key prefix. */
export type CatalogMapping = ReadonlyMap<string, { engineId: string; prefix?: string }>

const MAX_PER_MTOK = 1000

export function parsePriceCatalog(raw: unknown, mapping: CatalogMapping): CatalogPrice[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const prices: CatalogPrice[] = []

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const entry = value as Record<string, unknown>
    const provider = entry.litellm_provider
    const target = typeof provider === 'string' ? mapping.get(provider) : undefined
    if (!target) continue
    // Chat models only: embeddings, images and speech are priced differently
    // and never run through an engine here.
    if (entry.mode !== undefined && entry.mode !== 'chat' && entry.mode !== 'responses') continue

    const input = Number(entry.input_cost_per_token)
    const output = Number(entry.output_cost_per_token)
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue
    const inputPerMTok = round(input * 1_000_000)
    const outputPerMTok = round(output * 1_000_000)
    if (inputPerMTok > MAX_PER_MTOK || outputPerMTok > MAX_PER_MTOK) continue

    // Most providers' entries are namespaced ("groq/openai/gpt-oss-120b",
    // "zai/glm-4.7-flash"); the id the provider's own API uses is what follows
    // the prefix. Some entries appear both with and without it.
    const prefix = target.prefix ?? `${provider}/`
    const model = key.startsWith(prefix) ? key.slice(prefix.length) : key
    if (!model || model.includes(' ')) continue

    const flag = (value: unknown) => (typeof value === 'boolean' ? value : null)
    const context = Number(entry.max_input_tokens)
    prices.push({
      provider: target.engineId,
      model,
      inputPerMTok,
      outputPerMTok,
      supportsTools: flag(entry.supports_function_calling),
      supportsReasoning: flag(entry.supports_reasoning),
      supportsVision: flag(entry.supports_vision),
      contextTokens: Number.isInteger(context) && context > 0 ? context : null,
    })
  }
  return prices
}

/** Four decimal places, which is what the price column stores. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
