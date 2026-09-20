import { createHash } from 'crypto'

import { prisma } from '@/infrastructure/db/prisma'
import { getEmbedder, embeddableText } from '@/infrastructure/ai/embedder'

/**
 * Ticket embeddings: keeping them current, and using them to rank.
 *
 * Nothing here is required for the app to work. Every caller falls back to
 * lexical matching when embedding is switched off or the model cannot load, so
 * this is strictly an improvement in recall rather than a dependency.
 */

/**
 * The exact string an embedding's freshness is judged from.
 *
 * It must be reproducible in SQL, because the sweep finds stale rows with a
 * `WHERE` clause rather than by reading every ticket into memory — see
 * STALE_PREDICATE below, which is this same expression in Postgres. If the two
 * ever disagree the sweep either loops forever or never runs.
 */
function embeddingSource(title: string, description: string | null): string {
  return `${title}~~${description ?? ''}`
}

function embeddingHash(title: string, description: string | null): string {
  return createHash('md5').update(embeddingSource(title, description)).digest('hex')
}

/** The SQL twin of `embeddingHash`. Kept adjacent so they are edited together. */
const STALE_PREDICATE = `(
  "embedding" IS NULL
  OR "embeddingHash" IS DISTINCT FROM md5(coalesce("title", '') || '~~' || coalesce("description", ''))
)`

/**
 * Postgres array literal. Six decimals: the vectors are L2-normalised, so every
 * component sits in [-1, 1] and the seventh decimal cannot change a ranking —
 * while the shorter literal roughly halves what is sent over the wire.
 */
function toArrayLiteral(vector: Float32Array): string {
  const parts = new Array<string>(vector.length)
  for (let i = 0; i < vector.length; i++) parts[i] = vector[i].toFixed(6)
  return `{${parts.join(',')}}`
}

export interface SweepResult {
  embedded: number
  remaining: number
}

/**
 * Embeds a batch of tickets whose text has changed or was never embedded.
 *
 * Bounded on purpose. It is called from a cron and from a backfill script, and
 * an unbounded version would hold a connection open for minutes on a large
 * workspace and time out a serverless invocation.
 */
export async function sweepEmbeddings(limit = 200): Promise<SweepResult> {
  const embedder = getEmbedder()
  if (!embedder) return { embedded: 0, remaining: 0 }

  const pending = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; description: string | null }>
  >(
    `SELECT "id", "title", "description"
       FROM "tickets"
      WHERE "isArchived" = false AND ${STALE_PREDICATE}
      ORDER BY "updatedAt" DESC
      LIMIT $1`,
    limit,
  )

  if (pending.length === 0) return { embedded: 0, remaining: 0 }

  const vectors = await embedder.embed(
    pending.map((row) => embeddableText(row.title, row.description)),
  )

  // One statement per row rather than a single large one: the update is tiny,
  // and a failure part way through leaves the rest correctly embedded instead
  // of rolling the whole batch back.
  let embedded = 0
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]
    await prisma.$executeRawUnsafe(
      `UPDATE "tickets" SET "embedding" = $1::real[], "embeddingHash" = $2 WHERE "id" = $3`,
      toArrayLiteral(vectors[i]),
      embeddingHash(row.title, row.description),
      row.id,
    )
    embedded++
  }

  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM "tickets"
      WHERE "isArchived" = false AND ${STALE_PREDICATE}`,
  )

  return { embedded, remaining: Number(count) }
}

/** Embeds one ticket immediately. Used where freshness matters within a request. */
export async function embedTicketNow(ticketId: string): Promise<boolean> {
  const embedder = getEmbedder()
  if (!embedder) return false

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { title: true, description: true },
  })
  if (!ticket) return false

  const [vector] = await embedder.embed([embeddableText(ticket.title, ticket.description)])
  await prisma.$executeRawUnsafe(
    `UPDATE "tickets" SET "embedding" = $1::real[], "embeddingHash" = $2 WHERE "id" = $3`,
    toArrayLiteral(vector),
    embeddingHash(ticket.title, ticket.description),
    ticketId,
  )
  return true
}

/**
 * Chosen by measurement, not feel.
 *
 * This model puts genuinely unrelated titles around 0.40 and a real rephrasing
 * around 0.63-0.67, so the useful boundary is narrow. At 0.55, "make the
 * dashboard load faster" matched "responsive breakpoints" at 0.60 — close
 * enough to be noise, and a duplicate check that shows noise every time is one
 * people stop reading.
 */
const DEFAULT_MIN_SCORE = 0.62

export interface SemanticMatch {
  id: string
  key: string
  title: string
  statusName: string
  score: number
}

/**
 * The most semantically similar tickets in one project.
 *
 * Scored in the database rather than by reading vectors into memory: the
 * largest project here holds 2,167 tickets, and fetching their embeddings would
 * move several megabytes across the network to rank a handful of rows. The dot
 * product is the cosine because both sides are normalised.
 *
 * Always project-scoped. That is what keeps a sequential scan honest without a
 * vector index, and why this does not need pgvector.
 */
export async function semanticMatches(
  projectId: string,
  text: string,
  limit = 5,
  minScore = DEFAULT_MIN_SCORE,
): Promise<SemanticMatch[]> {
  const embedder = getEmbedder()
  if (!embedder) return []

  const trimmed = text.trim()
  if (!trimmed) return []

  const [vector] = await embedder.embed([trimmed])

  return prisma.$queryRawUnsafe<SemanticMatch[]>(
    `SELECT t."id",
            t."key",
            t."title",
            s."name" AS "statusName",
            (SELECT sum(a * b) FROM unnest(t."embedding", $1::real[]) AS u(a, b))::float8 AS score
       FROM "tickets" t
       JOIN "statuses" s ON s."id" = t."statusId"
      WHERE t."projectId" = $2
        AND t."isArchived" = false
        AND t."embedding" IS NOT NULL
      ORDER BY score DESC
      LIMIT $3`,
    toArrayLiteral(vector),
    projectId,
    limit,
  ).then((rows) => rows.filter((row) => row.score >= minScore))
}

/** How much of the workspace currently has a usable embedding. */
export async function embeddingCoverage(): Promise<{ embedded: number; total: number }> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ embedded: bigint; total: bigint }>>(
    `SELECT count("embedding")::bigint AS embedded, count(*)::bigint AS total
       FROM "tickets" WHERE "isArchived" = false`,
  )
  return { embedded: Number(row.embedded), total: Number(row.total) }
}
