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

export type BillingPlan = 'free' | 'list' | 'custom'

export interface ModelRates {
  list: { input: number; output: number } | null
  custom: { input: number; output: number } | null
}

/**
 * What one call cost, and what it would have cost at list price.
 *
 * Free tier: nothing was billed, but the list-price figure is still kept — it
 * is what the same work would cost the day the free tier runs out, and the
 * number to plan a budget with. Custom: the workspace's own rate, falling back
 * to the list price for a model nobody has priced yet.
 */
export function callCosts(
  plan: BillingPlan,
  rates: ModelRates,
  inputTokens: number,
  outputTokens: number,
): { actual: bigint; list: bigint } {
  const at = (rate: { input: number; output: number } | null) =>
    rate ? costMicros(inputTokens, outputTokens, rate.input, rate.output) : BigInt(0)
  const list = at(rates.list)
  if (plan === 'free') return { actual: BigInt(0), list }
  if (plan === 'custom') return { actual: rates.custom ? at(rates.custom) : list, list }
  return { actual: list, list }
}

/**
 * The month's likely total, from the pace so far: spend × days in the month
 * ÷ days elapsed. Null in the first day, when one afternoon is not a pace.
 */
export function projectMonth(spentSoFar: number, now: Date): number | null {
  const start = monthStart(now)
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const elapsedDays = (now.getTime() - start.getTime()) / 86_400_000
  if (elapsedDays < 1) return null
  const totalDays = (next.getTime() - start.getTime()) / 86_400_000
  return (spentSoFar / elapsedDays) * totalDays
}
