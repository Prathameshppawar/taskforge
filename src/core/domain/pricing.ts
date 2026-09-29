/**
 * List prices from the public model catalogue LiteLLM maintains
 * (model_prices_and_context_window.json) — the most widely used open source of
 * per-token prices, covering Anthropic, OpenAI and Groq.
 *
 * Parsed defensively: it is a third-party file fetched over the network, so
 * anything that is not a finite, non-negative price is ignored rather than
 * trusted, and an implausible one — over $1,000 per million tokens — is
 * treated as a mistake in the file, not a price to bill against.
 */

export type PricedProvider = 'anthropic' | 'openai' | 'groq'

export interface CatalogPrice {
  provider: PricedProvider
  model: string
  inputPerMTok: number
  outputPerMTok: number
}

const PROVIDERS = new Set<PricedProvider>(['anthropic', 'openai', 'groq'])
const MAX_PER_MTOK = 1000

export function parsePriceCatalog(raw: unknown): CatalogPrice[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const prices: CatalogPrice[] = []

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const entry = value as Record<string, unknown>
    const provider = entry.litellm_provider
    if (typeof provider !== 'string' || !PROVIDERS.has(provider as PricedProvider)) continue
    // Chat models only: embeddings, images and speech are priced differently
    // and never run through an engine here.
    if (entry.mode !== undefined && entry.mode !== 'chat' && entry.mode !== 'responses') continue

    const input = Number(entry.input_cost_per_token)
    const output = Number(entry.output_cost_per_token)
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue
    const inputPerMTok = round(input * 1_000_000)
    const outputPerMTok = round(output * 1_000_000)
    if (inputPerMTok > MAX_PER_MTOK || outputPerMTok > MAX_PER_MTOK) continue

    // Groq entries are namespaced ("groq/openai/gpt-oss-120b"); the id Groq's
    // own API uses is what follows the prefix. Anthropic and OpenAI entries
    // occasionally carry their provider as a prefix too.
    const model = key.replace(new RegExp(`^${provider}/`), '')
    if (!model || model.includes(' ')) continue

    prices.push({ provider: provider as PricedProvider, model, inputPerMTok, outputPerMTok })
  }
  return prices
}

/** Four decimal places, which is what the price column stores. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
