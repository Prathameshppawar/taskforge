import { prisma } from '@/infrastructure/db/prisma'
import { parsePriceCatalog } from '@/core/domain/pricing'

/**
 * Keeps model prices current from the public catalogue.
 *
 * Only prices marked "auto" are ever written: a price someone typed — a
 * negotiated rate, or $0 for a free tier — belongs to them. Costs already
 * recorded are not recalculated; they were snapshotted at the price of the
 * day, which is what that month actually cost.
 */

export const PRICE_CATALOG_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

export async function refreshModelPrices() {
  const response = await fetch(PRICE_CATALOG_URL, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`The price catalogue could not be fetched (HTTP ${response.status}).`)
  const catalog = parsePriceCatalog(await response.json())
  if (catalog.length === 0) throw new Error('The price catalogue was empty or unreadable, so no prices were changed.')

  const manual = new Set(
    (await prisma.aiModelPrice.findMany({ where: { source: 'manual' }, select: { provider: true, model: true } })).map(
      (row) => `${row.provider}/${row.model}`,
    ),
  )

  let updated = 0
  let kept = 0
  for (const price of catalog) {
    if (manual.has(`${price.provider}/${price.model}`)) {
      kept++
      continue
    }
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
