/**
 * Retry arithmetic for the background queue. Pure.
 */

/** 1 min, 5 min, 30 min, 2 h, 6 h — then the job is given up on. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360]

export function nextAttemptAt(attempts: number, now: Date): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1
  return new Date(now.getTime() + minutes * 60_000)
}

/** A job RUNNING this long was abandoned by a function that died. */
export const STALE_LOCK_MS = 10 * 60_000

export function isStale(lockedAt: Date | null, now: Date): boolean {
  return lockedAt !== null && now.getTime() - lockedAt.getTime() > STALE_LOCK_MS
}
