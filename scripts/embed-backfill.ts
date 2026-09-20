import 'dotenv/config'

import { sweepEmbeddings, embeddingCoverage } from '@/features/tickets/embeddings'
import { getEmbedder } from '@/infrastructure/ai/embedder'

/**
 * Backfills ticket embeddings.
 *
 * Idempotent and resumable: it repeats bounded sweeps until nothing is stale,
 * so it can be interrupted and run again without redoing finished work.
 */
async function main() {
  const embedder = getEmbedder()
  if (!embedder) {
    console.log('\nEmbedding is disabled (EMBEDDING_PROVIDER=none). Nothing to do.\n')
    return
  }

  const before = await embeddingCoverage()
  console.log(`\n${embedder.model} — ${embedder.dimensions} dimensions`)
  console.log(`${before.embedded}/${before.total} tickets embedded\n`)

  const started = Date.now()
  let total = 0

  for (;;) {
    const batchStart = Date.now()
    const { embedded, remaining } = await sweepEmbeddings(200)
    if (embedded === 0) break

    total += embedded
    const rate = embedded / ((Date.now() - batchStart) / 1000)
    console.log(
      `  +${embedded}  (${rate.toFixed(0)}/s)  ${remaining} remaining`,
    )
    if (remaining === 0) break
  }

  const after = await embeddingCoverage()
  const seconds = (Date.now() - started) / 1000
  console.log(
    `\n${total} embedded in ${seconds.toFixed(1)}s — now ${after.embedded}/${after.total}\n`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import('@/infrastructure/db/prisma')
    await prisma.$disconnect()
  })
