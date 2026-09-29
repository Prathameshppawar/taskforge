import type { StatusCategory, TicketKind } from '@prisma/client'

/**
 * How work flows: time in each status, service targets, and what is stuck.
 *
 * Everything here reads the status history the database keeps (see
 * TicketStatusChange) and is pure, so the domain suite can pin the clock
 * arithmetic — the part of an SLA that is easy to get subtly wrong.
 */

export interface StatusChange {
  toStatusId: string | null
  toCategory: StatusCategory
  changedAt: Date
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** "2d 4h", "3h 20m", "45m", "<1m". */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < 60_000) return '<1m'
  const days = Math.floor(safe / DAY)
  const hours = Math.floor((safe % DAY) / HOUR)
  const minutes = Math.floor((safe % HOUR) / 60_000)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** History in time order, each change with how long it lasted. */
export function segments(changes: StatusChange[], now: Date) {
  const ordered = [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
  return ordered.map((change, index) => {
    const end = ordered[index + 1]?.changedAt ?? now
    return { ...change, endedAt: end, ms: Math.max(0, end.getTime() - change.changedAt.getTime()) }
  })
}

/**
 * Total time spent in each status, longest first. A ticket that went back to
 * a status adds to its total rather than starting a second row.
 */
export function timeInStatus(changes: StatusChange[], now: Date): Array<{ statusId: string | null; category: StatusCategory; ms: number }> {
  const totals = new Map<string, { statusId: string | null; category: StatusCategory; ms: number }>()
  for (const segment of segments(changes, now)) {
    const key = segment.toStatusId ?? `category:${segment.toCategory}`
    const entry = totals.get(key) ?? { statusId: segment.toStatusId, category: segment.toCategory, ms: 0 }
    entry.ms += segment.ms
    totals.set(key, entry)
  }
  return [...totals.values()].sort((a, b) => b.ms - a.ms)
}

// --- service targets ---------------------------------------------------------

export type ClockState = 'running' | 'at_risk' | 'breached' | 'met' | 'met_late' | 'paused'

export interface Clock {
  state: ClockState
  /** When the target falls due, given the pauses so far. */
  dueAt: Date
  /** Time counted against the target, pauses excluded. */
  spentMs: number
  budgetMs: number
  /** When it stopped: the response, or the resolution. */
  stoppedAt: Date | null
}

/** The share of a target spent before it counts as at risk. */
export const AT_RISK_SHARE = 0.8

export function slaApplies(kind: TicketKind, slaKinds: string): boolean {
  return slaKinds
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .includes(kind)
}

function clockState(spentMs: number, budgetMs: number, stopped: boolean, paused: boolean): ClockState {
  if (stopped) return spentMs <= budgetMs ? 'met' : 'met_late'
  if (spentMs > budgetMs) return 'breached'
  if (paused) return 'paused'
  return spentMs >= budgetMs * AT_RISK_SHARE ? 'at_risk' : 'running'
}

/**
 * Response and resolution clocks for one ticket.
 *
 * The response clock runs from creation to the first response. The
 * resolution clock runs from creation to completion, and pauses while the
 * ticket is Blocked — a ticket waiting on someone outside the team should not
 * breach the team's target — so its due time moves out by every pause.
 * Reopening a finished ticket restarts nothing: the clock simply runs again
 * from where it stopped, because the target was for the work, not the status.
 */
export function slaClocks(input: {
  createdAt: Date
  firstResponseAt: Date | null
  completedAt: Date | null
  changes: StatusChange[]
  respondWithinHours: number | null
  resolveWithinHours: number | null
  now: Date
}): { respond: Clock | null; resolve: Clock | null } {
  const { createdAt, now } = input

  let respond: Clock | null = null
  if (input.respondWithinHours) {
    const budgetMs = input.respondWithinHours * HOUR
    const stoppedAt = input.firstResponseAt
    const spentMs = Math.max(0, (stoppedAt ?? now).getTime() - createdAt.getTime())
    respond = {
      state: clockState(spentMs, budgetMs, stoppedAt !== null, false),
      dueAt: new Date(createdAt.getTime() + budgetMs),
      spentMs,
      budgetMs,
      stoppedAt,
    }
  }

  let resolve: Clock | null = null
  if (input.resolveWithinHours) {
    const budgetMs = input.resolveWithinHours * HOUR
    const stoppedAt = input.completedAt
    const end = stoppedAt ?? now
    let pausedMs = 0
    let spentMs = 0
    let currentlyPaused = false
    for (const segment of segments(input.changes, end)) {
      // Only the part of each segment inside [createdAt, end] counts.
      const from = Math.max(segment.changedAt.getTime(), createdAt.getTime())
      const to = Math.min(segment.endedAt.getTime(), end.getTime())
      if (to <= from) continue
      if (segment.toCategory === 'BLOCKED') pausedMs += to - from
      else if (segment.toCategory !== 'DONE' && segment.toCategory !== 'CANCELLED') spentMs += to - from
      if (segment.endedAt.getTime() >= end.getTime()) currentlyPaused = segment.toCategory === 'BLOCKED'
    }
    // No history at all: the whole span counts.
    if (input.changes.length === 0) spentMs = Math.max(0, end.getTime() - createdAt.getTime())
    resolve = {
      state: clockState(spentMs, budgetMs, stoppedAt !== null, currentlyPaused),
      dueAt: new Date(createdAt.getTime() + budgetMs + pausedMs),
      spentMs,
      budgetMs,
      stoppedAt,
    }
  }

  return { respond, resolve }
}

/** Which alerts a clock calls for now, as alert keys. */
export function dueAlerts(which: 'respond' | 'resolve', clock: Clock | null): string[] {
  if (!clock) return []
  if (clock.state === 'breached') return [`${which}:warn`, `${which}:breach`]
  if (clock.state === 'at_risk') return [`${which}:warn`]
  return []
}

// --- the board -----------------------------------------------------------------

const ACTIVE: ReadonlySet<StatusCategory> = new Set<StatusCategory>(['IN_PROGRESS', 'REVIEW', 'BLOCKED'])

/**
 * Days a ticket has sat in an active status past the project's threshold, or
 * null when it is not stuck. Backlog and To Do do not count: waiting to be
 * started is not being stuck.
 */
export function stuckDays(category: StatusCategory, statusChangedAt: Date, stuckAfterDays: number | null, now: Date): number | null {
  if (!stuckAfterDays || !ACTIVE.has(category)) return null
  const days = Math.floor((now.getTime() - statusChangedAt.getTime()) / DAY)
  return days >= stuckAfterDays ? days : null
}

export type WipState = 'none' | 'ok' | 'full' | 'over'

export function wipState(count: number, limit: number | null): WipState {
  if (!limit) return 'none'
  if (count > limit) return 'over'
  return count === limit ? 'full' : 'ok'
}

/**
 * Where finished work waited: the average time per status across a set of
 * completed tickets' histories, excluding the terminal status itself.
 */
export function averageTimeInStatus(
  histories: Array<{ changes: StatusChange[]; completedAt: Date }>,
): Array<{ statusId: string | null; category: StatusCategory; avgMs: number; tickets: number }> {
  const totals = new Map<string, { statusId: string | null; category: StatusCategory; ms: number; tickets: number }>()
  for (const history of histories) {
    for (const entry of timeInStatus(history.changes, history.completedAt)) {
      if (entry.category === 'DONE' || entry.category === 'CANCELLED') continue
      const key = entry.statusId ?? `category:${entry.category}`
      const total = totals.get(key) ?? { statusId: entry.statusId, category: entry.category, ms: 0, tickets: 0 }
      total.ms += entry.ms
      total.tickets += 1
      totals.set(key, total)
    }
  }
  return [...totals.values()]
    .map((total) => ({ statusId: total.statusId, category: total.category, avgMs: total.ms / total.tickets, tickets: total.tickets }))
    .sort((a, b) => b.avgMs - a.avgMs)
}
