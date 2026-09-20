import 'dotenv/config'

import { prisma } from '@/infrastructure/db/prisma'
import { sweepEmbeddings, semanticMatches } from '@/features/tickets/embeddings'
import { getEmbedder } from '@/infrastructure/ai/embedder'

/**
 * Semantic similarity verification.
 *
 * Needs a database and the model, so it lives here rather than in the domain
 * suite. What it is really protecting is an invariant with no natural failure
 * mode: the freshness check exists twice — `embeddingHash` in TypeScript and
 * its SQL twin in the sweep's WHERE clause — and if they ever disagree nothing
 * throws. The sweep either rewrites the same rows forever or stops noticing
 * edits, and duplicate detection silently decays.
 */

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const SUFFIX = Math.random().toString(36).slice(2, 8)
const TITLE = `Customers are unable to sign in ${SUFFIX}`
const REPHRASED = `Login page keeps rejecting valid credentials ${SUFFIX}`

/** The staleness predicate, written out exactly as the sweep uses it. */
const STALE = `("embedding" IS NULL OR "embeddingHash" IS DISTINCT FROM md5(coalesce("title",'') || '~~' || coalesce("description",'')))`

async function isStale(id: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "tickets" WHERE "id" = $1 AND ${STALE}`,
    id,
  )
  return Number(rows[0].n) === 1
}

async function main() {
  const embedder = getEmbedder()

  console.log('\n── Embeddings ──')
  if (!embedder) {
    console.log('  embedding disabled (EMBEDDING_PROVIDER=none) — nothing to verify\n')
    return
  }
  console.log(`  model: ${embedder.model} (${embedder.dimensions} dimensions)\n`)

  const project = await prisma.project.findFirstOrThrow({ select: { id: true } })
  const [status, priority, type, reporter] = await Promise.all([
    prisma.status.findFirstOrThrow({ where: { projectId: project.id }, select: { id: true } }),
    prisma.priority.findFirstOrThrow({ where: { projectId: project.id }, select: { id: true } }),
    prisma.ticketType.findFirstOrThrow({ where: { projectId: project.id }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ select: { id: true } }),
  ])
  const last = await prisma.ticket.findFirst({
    where: { projectId: project.id },
    orderBy: { number: 'desc' },
    select: { number: true },
  })

  const ticket = await prisma.ticket.create({
    data: {
      projectId: project.id,
      number: (last?.number ?? 0) + 1,
      key: `VERIFY-${SUFFIX.toUpperCase()}`,
      title: TITLE,
      description: 'Reported by two customers this morning.',
      statusId: status.id,
      priorityId: priority.id,
      typeId: type.id,
      reporterId: reporter.id,
    },
    select: { id: true },
  })

  try {
    check('a new ticket starts stale', await isStale(ticket.id))

    await sweepEmbeddings(1000)

    const row = await prisma.$queryRawUnsafe<Array<{ has: boolean }>>(
      `SELECT ("embedding" IS NOT NULL) AS has FROM "tickets" WHERE "id" = $1`,
      ticket.id,
    )
    check('the sweep embeds it', row[0].has)

    // The invariant. If the hashes disagreed this would still read as stale.
    check('it is no longer stale, so the hash matches its SQL twin', !(await isStale(ticket.id)))

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { title: `${TITLE} (updated)` },
    })
    check('editing the title makes it stale again', await isStale(ticket.id))

    await sweepEmbeddings(1000)
    check('the sweep picks the edit up', !(await isStale(ticket.id)))

    // The claim the whole feature rests on.
    const words = (text: string) =>
      new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2 && w !== SUFFIX && w !== 'updated'),
      )
    const shared = [...words(TITLE)].filter((w) => words(REPHRASED).has(w))
    check('the two phrasings share no words', shared.length === 0, shared.join(', '))

    const matches = await semanticMatches(project.id, REPHRASED, 10)
    const found = matches.find((m) => m.id === ticket.id)
    check(
      'semantic search finds it anyway',
      Boolean(found),
      found ? undefined : 'no match above the threshold',
    )
    if (found) {
      console.log(`      scored ${(found.score * 100).toFixed(0)}% — lexical overlap scores 0`)
    }
  } finally {
    await prisma.ticket.delete({ where: { id: ticket.id } })
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
