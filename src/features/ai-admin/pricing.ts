import { prisma } from '@/infrastructure/db/prisma'
import { parsePriceCatalog } from '@/core/domain/pricing'
import { priceCatalogMapping } from '@/core/domain/engine-catalog'

/**
 * Keeps model list prices current from the public catalogue.
 *
 * Each model has two prices: the list price, which is always the catalogue's,
 * and optionally the workspace's own rate (a negotiated price, a
 * subscription's effective rate), which a refresh never touches. Costs already
 * recorded are not recalculated; they were snapshotted at the price of the
 * day, which is what that month actually cost.
 */

export const PRICE_CATALOG_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

/** Where people can read the same prices, linked from the AI page. */
export const PRICE_CATALOG_PAGE = 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json'

export async function refreshModelPrices() {
  const response = await fetch(PRICE_CATALOG_URL, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`The price catalogue could not be fetched (HTTP ${response.status}).`)
  const catalog = parsePriceCatalog(await response.json(), priceCatalogMapping())
  if (catalog.length === 0) throw new Error('The price catalogue was empty or unreadable, so no prices were changed.')

  // The list price is always the catalogue's; a workspace's own rate lives in
  // the custom columns, which a refresh never touches.
  const customised = await prisma.aiModelPrice.count({ where: { customInputPerMTok: { not: null } } })
  let updated = 0
  const kept = customised
  for (const price of catalog) {
    await prisma.aiModelPrice.upsert({
      where: { provider_model: { provider: price.provider, model: price.model } },
      create: { ...price, source: 'auto' },
      update: { inputPerMTok: price.inputPerMTok, outputPerMTok: price.outputPerMTok, source: 'auto' },
    })
    updated++
  }
  return { updated, kept, fetchedAt: new Date() }
}

/** The price for one model, refreshing from the catalogue first if there is none yet. */
export async function ensurePrice(provider: string, model: string) {
  const existing = await prisma.aiModelPrice.findUnique({ where: { provider_model: { provider, model } } })
  if (existing) return existing
  await refreshModelPrices().catch(() => null)
  return prisma.aiModelPrice.findUnique({ where: { provider_model: { provider, model } } })
}
