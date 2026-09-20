import { prisma } from '@/infrastructure/db/prisma'
import { semanticMatches } from './embeddings'

/**
 * How long work like this has actually taken.
 *
 * Deliberately not an AI call. A model asked "how long will this take?" will
 * answer confidently from nothing, and a number somebody plans around should
 * come from what happened rather than what sounds plausible. This finds
 * semantically similar tickets that are *finished* and reports their real
 * spread — which is also why it can say "not enough history" and mean it.
 */

/** Below this there is no distribution worth reporting, only anecdote. */
const MIN_SAMPLE = 3

/** Ignore anything that took longer than this — it was abandoned, not worked on. */
const MAX_PLAUSIBLE_DAYS = 365

export interface Comparable {
  key: string
  title: string
  days: number
}

export interface HistoricalEstimate {
  sampleSize: number
  medianDays: number
  fastestDays: number
  slowestDays: number
  comparable: Comparable[]
}

/**
 * Nearest-rank percentile over a sorted list.
 *
 * Pure, so the edge cases are asserted rather than hoped for: a single value is
 * its own median, and an even-length list does not interpolate — with samples
 * this small, a real observed duration is more honest than an average of two.
 */
export function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const rank = Math.ceil(clamped * sortedAscending.length)
  return sortedAscending[Math.max(0, rank - 1)]
}

/**
 * Days between two instants, or null when the pair cannot be believed.
 *
 * Seed data once carried tickets completed *before* they were created. Silently
 * dropping such a row is right; silently counting it as a negative duration
 * would drag a median below zero and nobody would notice.
 */
export function cycleDays(createdAt: Date, completedAt: Date | null): number | null {
  if (!completedAt) return null

  const days = (completedAt.getTime() - createdAt.getTime()) / 86_400_000
  if (!Number.isFinite(days) || days < 0 || days > MAX_PLAUSIBLE_DAYS) return null

  // Anything finished the same day counts as a day, so a median never reads 0.
  return Math.max(1, Math.round(days))
}

export function summarise(samples: Comparable[]): HistoricalEstimate | null {
  if (samples.length < MIN_SAMPLE) return null

  const sorted = samples.map((sample) => sample.days).sort((a, b) => a - b)

  return {
    sampleSize: samples.length,
    medianDays: percentile(sorted, 0.5),
    fastestDays: sorted[0],
    slowestDays: sorted[sorted.length - 1],
    // The closest few, for "compared with what?" — a number without its
    // evidence is just a different kind of guess.
    comparable: samples.slice(0, 3),
  }
}

/**
 * Finds finished work resembling this text and reports how long it took.
 *
 * Returns null rather than a wide, meaningless range when the project has not
 * finished enough comparable work yet.
 */
export async function estimateFromHistory(
  projectId: string,
  text: string,
  excludeTicketId?: string,
): Promise<HistoricalEstimate | null> {
  // A wider net than duplicate detection: this wants *comparable* work, not the
  // same ticket written twice, so the bar is lower and the pool larger.
  const matches = await semanticMatches(projectId, text, 40, 0.5).catch(() => [])
  if (matches.length === 0) return null

  const candidateIds = matches
    .map((match) => match.id)
    .filter((id) => id !== excludeTicketId)

  if (candidateIds.length === 0) return null

  const finished = await prisma.ticket.findMany({
    where: {
      id: { in: candidateIds },
      completedAt: { not: null },
      status: { category: 'DONE' },
    },
    select: { id: true, key: true, title: true, createdAt: true, completedAt: true },
  })

  // Keep the semantic ordering — the most similar ticket is the most relevant
  // comparison, and a database `IN` returns rows in whatever order it likes.
  const byId = new Map(finished.map((ticket) => [ticket.id, ticket]))

  const samples: Comparable[] = []
  for (const id of candidateIds) {
    const ticket = byId.get(id)
    if (!ticket) continue

    const days = cycleDays(ticket.createdAt, ticket.completedAt)
    if (days === null) continue

    samples.push({ key: ticket.key, title: ticket.title, days })
  }

  return summarise(samples)
}
