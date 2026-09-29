import { prisma } from '@/infrastructure/db/prisma'
import { projectUnit } from '@/features/cycles/queries'
import { dailySeries, forecastCompletion, hashSeed, type ForecastResult } from '@/core/domain/forecast'

/** Eight weeks: long enough to include a slow week, short enough to be about this team. */
const HISTORY_DAYS = 56

/**
 * A cycle's forecast: its unfinished work against the project's throughput
 * over the last eight weeks, from the status history. In points where the
 * project points its work — with unpointed tickets counted at the median of
 * the pointed ones, on both sides, so leaving points off neither hides work
 * nor speeds the team up.
 */
export async function forecastCycle(cycleId: string, now = new Date()): Promise<(ForecastResult & { unit: 'points' | 'tickets'; remaining: number }) | null> {
  const cycle = await prisma.cycle.findUnique({ where: { id: cycleId }, select: { id: true, projectId: true, endDate: true, state: true } })
  if (!cycle || cycle.state === 'CLOSED') return null
  const unit = await projectUnit(cycle.projectId)
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000)

  const [done, open] = await Promise.all([
    prisma.ticketStatusChange.findMany({
      where: { toCategory: 'DONE', NOT: { fromCategory: 'DONE' }, changedAt: { gte: since }, ticket: { projectId: cycle.projectId } },
      select: { ticketId: true, changedAt: true, ticket: { select: { storyPoints: true } } },
      orderBy: { changedAt: 'asc' },
    }),
    prisma.ticket.findMany({
      where: { cycleId, isArchived: false, status: { category: { notIn: ['DONE', 'CANCELLED'] } } },
      select: { storyPoints: true },
    }),
  ])

  // A ticket reopened and finished again counts once, on its first finish.
  const first = new Map<string, { at: Date; points: number | null }>()
  for (const change of done) if (!first.has(change.ticketId)) first.set(change.ticketId, { at: change.changedAt, points: change.ticket.storyPoints })

  const pointed = [...first.values(), ...open.map((ticket) => ({ points: ticket.storyPoints }))]
    .map((entry) => entry.points)
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b)
  const median = pointed.length ? pointed[Math.floor((pointed.length - 1) / 2)] : 1
  const weight = (points: number | null) => (unit === 'points' ? (points && points > 0 ? points : median) : 1)

  const series = dailySeries([...first.values()].map((entry) => ({ at: entry.at, weight: weight(entry.points) })), HISTORY_DAYS, now)
  const remaining = open.reduce((sum, ticket) => sum + weight(ticket.storyPoints), 0)
  const daysToDue = cycle.endDate ? Math.max(0, Math.ceil((cycle.endDate.getTime() - now.getTime()) / 86_400_000)) : null

  return {
    ...forecastCompletion({ dailyThroughput: series, remaining, daysToDue, seed: hashSeed(`${cycle.id}:${now.toISOString().slice(0, 10)}`) }),
    unit,
    remaining,
  }
}

export type CycleForecast = NonNullable<Awaited<ReturnType<typeof forecastCycle>>>
