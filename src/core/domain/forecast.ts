/**
 * When will it be done? A Monte Carlo forecast from real throughput.
 *
 * Instead of asking anyone to estimate, it replays the team's own history:
 * each simulated day draws one real day's throughput from the last few weeks,
 * and a run ends when the remaining work is covered. Thousands of runs give a
 * spread, read as "50% by …, 85% by …". Weekends and slow days are in the
 * history, so they are in the forecast. Pure and seeded, so a page renders
 * the same answer every time for the same data.
 */

export interface Forecast {
  /** Calendar days from today, at each confidence. */
  p50: number
  p85: number
  p95: number
  /** Chance of being done by the due date, when there is one. */
  onTime: number | null
  runs: number
  /** How much history the forecast stands on. */
  basis: { days: number; completed: number }
}

export type ForecastResult = { ok: true; forecast: Forecast } | { ok: false; reason: string }

/** A small, fast, seedable PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return hash >>> 0
}

/** Minimum history before a forecast is worth showing. */
export const MIN_DAYS = 14
export const MIN_COMPLETED = 8
const MAX_DAYS = 730

export function forecastCompletion(input: {
  /** Work finished on each of the last N calendar days, oldest first. */
  dailyThroughput: number[]
  remaining: number
  /** Days from today to the due date, if there is one. */
  daysToDue?: number | null
  runs?: number
  seed?: number
}): ForecastResult {
  const history = input.dailyThroughput
  const completed = history.reduce((sum, value) => sum + value, 0)
  if (input.remaining <= 0) {
    return { ok: true, forecast: { p50: 0, p85: 0, p95: 0, onTime: input.daysToDue == null ? null : 1, runs: 0, basis: { days: history.length, completed } } }
  }
  if (history.length < MIN_DAYS) return { ok: false, reason: `needs at least ${MIN_DAYS} days of history` }
  if (completed < MIN_COMPLETED) return { ok: false, reason: `needs at least ${MIN_COMPLETED} finished tickets in the last ${history.length} days` }

  const runs = input.runs ?? 2000
  const random = seededRandom(input.seed ?? 1)
  const outcomes: number[] = []
  for (let run = 0; run < runs; run++) {
    let left = input.remaining
    let days = 0
    while (left > 0 && days < MAX_DAYS) {
      left -= history[Math.floor(random() * history.length)]
      days++
    }
    outcomes.push(days)
  }
  outcomes.sort((a, b) => a - b)
  const at = (share: number) => outcomes[Math.min(outcomes.length - 1, Math.ceil(share * outcomes.length) - 1)]
  const onTime = input.daysToDue == null ? null : outcomes.filter((days) => days <= input.daysToDue!).length / runs
  return {
    ok: true,
    forecast: { p50: at(0.5), p85: at(0.85), p95: at(0.95), onTime: onTime === null ? null : Math.round(onTime * 100) / 100, runs, basis: { days: history.length, completed } },
  }
}

/** Daily totals from dated completions, oldest first, zeros included. */
export function dailySeries(completions: Array<{ at: Date; weight: number }>, days: number, now: Date): number[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000
  const start = end - days * 86_400_000
  const series = Array.from({ length: days }, () => 0)
  for (const entry of completions) {
    const t = entry.at.getTime()
    if (t < start || t >= end) continue
    series[Math.floor((t - start) / 86_400_000)] += entry.weight
  }
  return series
}

/** "12 Oct" style date for a number of days from now. */
export function daysFromNow(days: number, now: Date): Date {
  return new Date(now.getTime() + days * 86_400_000)
}
