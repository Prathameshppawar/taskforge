/**
 * Money and time arithmetic for AI budgets. Pure, so the domain suite pins it.
 *
 * Costs are integers in millionths of a dollar. A Groq call can cost a
 * fraction of a cent, and summing thousands of floating-point fractions drifts
 * by more than a budget report can honestly round away.
 */

/** Cost of one call, in micro-dollars, from per-million-token prices. */
export function costMicros(
  inputTokens: number,
  outputTokens: number,
  inputPerMTok: number,
  outputPerMTok: number,
): bigint {
  // tokens × $/1M tokens × 1e6 µ$/$ ÷ 1e6 = tokens × $/1M, already in µ$.
  return BigInt(Math.round(inputTokens * inputPerMTok + outputTokens * outputPerMTok))
}

export function microsToUsd(micros: bigint | number): number {
  return Number(micros) / 1_000_000
}

/** First instant of the calendar month `date` falls in, UTC. */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/** "2026-09" — the key budget alerts are deduplicated by. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The alert threshold a budget has newly crossed, or null.
 *
 * Each threshold fires once per month: `lastAlert` records the highest one
 * already sent ("2026-09:80"), and a new month resets it. Crossing straight
 * from under 80% to over 100% sends only the 100% alert — two emails in the
 * same minute say nothing the second does not.
 */
export function thresholdToAlert(
  spentMicros: bigint,
  limitUsd: number,
  lastAlert: string | null,
  now: Date,
): 80 | 100 | null {
  if (limitUsd <= 0) return null
  const percent = (Number(spentMicros) / (limitUsd * 1_000_000)) * 100
  const reached = percent >= 100 ? 100 : percent >= 80 ? 80 : null
  if (!reached) return null

  const month = monthKey(now)
  const [alertMonth, alertLevel] = (lastAlert ?? '').split(':')
  const already = alertMonth === month ? Number(alertLevel) : 0
  return reached > already ? reached : null
}

/** Start of the previous ISO week (Monday 00:00 UTC) and of this one. */
export function lastWeekRange(now: Date): { from: Date; to: Date } {
  const day = (now.getUTCDay() + 6) % 7 // Monday = 0
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const from = new Date(to.getTime() - 7 * 86_400_000)
  return { from, to }
}
