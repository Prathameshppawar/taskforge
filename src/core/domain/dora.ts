/**
 * The four DORA delivery metrics and their performance bands.
 *
 * Bands follow the DORA research thresholds. Every figure is derived from
 * TaskForge's own record — production deployments, when a shipped ticket's
 * work first appeared in git, and Production-kind tickets — so a number here
 * can always be traced to the rows that produced it.
 */

export type DoraBand = 'elite' | 'high' | 'medium' | 'low'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Production deployments per week. */
export function frequencyBand(perWeek: number): DoraBand {
  if (perWeek >= 7) return 'elite' // at least daily
  if (perWeek >= 1) return 'high' // at least weekly
  if (perWeek >= 0.25) return 'medium' // at least monthly
  return 'low'
}

/** Median time from a change's first commit to running in production. */
export function leadTimeBand(ms: number): DoraBand {
  if (ms < DAY) return 'elite'
  if (ms < 7 * DAY) return 'high'
  if (ms < 30 * DAY) return 'medium'
  return 'low'
}

/** Share of production deployments followed by a production incident. */
export function failureRateBand(rate: number): DoraBand {
  if (rate <= 0.05) return 'elite'
  if (rate <= 0.1) return 'high'
  if (rate <= 0.15) return 'medium'
  return 'low'
}

/** Median time to resolve a production incident. */
export function recoveryBand(ms: number): DoraBand {
  if (ms < HOUR) return 'elite'
  if (ms < DAY) return 'high'
  if (ms < 7 * DAY) return 'medium'
  return 'low'
}

/**
 * Deployments followed by a production issue within `windowMs` count as
 * failed changes. Each deployment counts once, however many issues followed.
 */
export function changeFailureRate(
  deployments: readonly Date[],
  incidents: readonly Date[],
  windowMs = DAY,
): number | null {
  if (deployments.length === 0) return null
  const failed = deployments.filter((deployed) =>
    incidents.some((opened) => opened.getTime() >= deployed.getTime() && opened.getTime() - deployed.getTime() <= windowMs),
  ).length
  return failed / deployments.length
}

/** "3.2 h", "4 days", "45 min" — durations at the scale DORA cares about. */
export function formatSpan(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (ms < 2 * DAY) return `${Math.round((ms / HOUR) * 10) / 10} h`
  return `${Math.round((ms / DAY) * 10) / 10} days`
}
