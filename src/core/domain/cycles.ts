import type { StatusCategory } from '@prisma/client'

/**
 * Sprints and milestones: the burn-up, and filling one to capacity.
 *
 * Pure, over the two histories the database keeps — status changes and cycle
 * membership changes — so a burn-up shows what was actually true each day,
 * including scope added halfway through, rather than today's scope drawn as
 * if it had always been there.
 */

const DAY = 86_400_000

export interface CycleTicketHistory {
  id: string
  points: number | null
  cycleChanges: Array<{ toCycleId: string | null; changedAt: Date }>
  statusChanges: Array<{ toCategory: StatusCategory; changedAt: Date }>
}

export interface BurnupPoint {
  /** Midnight UTC of the day. */
  day: string
  scope: number
  done: number
}

function lastBefore<T extends { changedAt: Date }>(changes: T[], at: number): T | undefined {
  let found: T | undefined
  for (const change of changes) {
    if (change.changedAt.getTime() <= at && (!found || change.changedAt.getTime() >= found.changedAt.getTime())) found = change
  }
  return found
}

/** Points where the project points its work; otherwise one per ticket. */
export function burnupUnit(tickets: Array<{ points: number | null }>): 'points' | 'tickets' {
  return tickets.some((ticket) => (ticket.points ?? 0) > 0) ? 'points' : 'tickets'
}

/**
 * One point per day from the cycle's start to today (or its end, if sooner).
 * A ticket counts on a day when, at the end of that day, it was in the cycle;
 * it counts as done when its status at that moment was Done.
 */
export function burnup(input: {
  cycleId: string
  start: Date
  end: Date | null
  now: Date
  tickets: CycleTicketHistory[]
  unit: 'points' | 'tickets'
}): BurnupPoint[] {
  const first = Date.UTC(input.start.getUTCFullYear(), input.start.getUTCMonth(), input.start.getUTCDate())
  const lastMoment = Math.min(input.now.getTime(), input.end ? input.end.getTime() + DAY - 1 : input.now.getTime())
  const points: BurnupPoint[] = []
  for (let day = first; day <= lastMoment && points.length < 366; day += DAY) {
    const at = Math.min(day + DAY - 1, input.now.getTime())
    let scope = 0
    let done = 0
    for (const ticket of input.tickets) {
      const membership = lastBefore(ticket.cycleChanges, at)
      if (membership?.toCycleId !== input.cycleId) continue
      const weight = input.unit === 'points' ? (ticket.points ?? 0) : 1
      scope += weight
      if (lastBefore(ticket.statusChanges, at)?.toCategory === 'DONE') done += weight
    }
    points.push({ day: new Date(day).toISOString().slice(0, 10), scope, done })
  }
  return points
}

export interface FillCandidate {
  id: string
  key: string
  points: number | null
  /** Keys of unfinished tickets that block this one. */
  blockedBy: string[]
}

export interface FillResult {
  chosen: Array<{ id: string; key: string; weight: number; assumed: boolean }>
  skipped: Array<{ key: string; reason: string }>
  load: number
}

/**
 * Takes backlog tickets in rank order until the cycle is full.
 *
 * Deterministic and explainable: nothing is chosen that the ranking did not
 * already put first. A ticket blocked by unfinished work outside the cycle is
 * skipped, because planning it in only plans a stall. Unpointed tickets count
 * as the median of the pointed ones — counting them as zero would quietly
 * overfill every cycle — and are marked as assumed.
 */
export function fillToCapacity(input: {
  candidates: FillCandidate[]
  capacity: number
  currentLoad: number
  /** Keys already in the cycle, whose blockers are not an obstacle. */
  inCycle: string[]
  unit: 'points' | 'tickets'
}): FillResult {
  const pointed = input.candidates
    .map((candidate) => candidate.points)
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b)
  const median = pointed.length ? pointed[Math.floor((pointed.length - 1) / 2)] : 1

  const inCycle = new Set(input.inCycle)
  const chosen: FillResult['chosen'] = []
  const skipped: FillResult['skipped'] = []
  let load = input.currentLoad

  for (const candidate of input.candidates) {
    const assumed = input.unit === 'points' && !(candidate.points && candidate.points > 0)
    const weight = input.unit === 'points' ? (assumed ? median : candidate.points!) : 1
    const blockers = candidate.blockedBy.filter((key) => !inCycle.has(key))
    if (blockers.length > 0) {
      skipped.push({ key: candidate.key, reason: `blocked by ${blockers.join(', ')}` })
      continue
    }
    if (load + weight > input.capacity) {
      skipped.push({ key: candidate.key, reason: `would exceed capacity (${load} + ${weight} > ${input.capacity})` })
      continue
    }
    chosen.push({ id: candidate.id, key: candidate.key, weight, assumed })
    inCycle.add(candidate.key)
    load += weight
    if (load >= input.capacity) break
  }

  return { chosen, skipped, load }
}

/** The next free name in a series: "Sprint 4" after "Sprint 3". */
export function nextCycleName(existing: string[], kind: 'SPRINT' | 'MILESTONE'): string {
  const prefix = kind === 'SPRINT' ? 'Sprint' : 'Milestone'
  const numbers = existing
    .map((name) => new RegExp(`^${prefix}\\s+(\\d+)$`, 'i').exec(name.trim())?.[1])
    .filter(Boolean)
    .map(Number)
  return `${prefix} ${numbers.length ? Math.max(...numbers) + 1 : 1}`
}
