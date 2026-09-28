import { prisma } from '@/infrastructure/db/prisma'
import {
  changeFailureRate,
  failureRateBand,
  frequencyBand,
  leadTimeBand,
  median,
  recoveryBand,
  type DoraBand,
} from '@/core/domain/dora'

/**
 * DORA metrics for one project over the last `days` days, from its own record.
 * Each metric is null — shown as "not enough data" — rather than zero when
 * there is nothing to measure, because "zero failures" and "no deployments"
 * mean opposite things.
 */
export async function getDeliveryMetrics(projectId: string, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000)
  const repos = await prisma.projectRepo.findMany({ where: { projectId }, select: { repoId: true } })
  const repoIds = repos.map((entry) => entry.repoId)

  const [deployments, incidents] = await Promise.all([
    repoIds.length
      ? prisma.deployment.findMany({
          where: { repoId: { in: repoIds }, isProduction: true, state: 'SUCCESS', createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            tickets: {
              where: { ticket: { projectId } },
              select: { ticket: { select: { gitRefs: { orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } } } } },
            },
          },
        })
      : Promise.resolve([]),
    prisma.ticket.findMany({
      where: { projectId, type: { kind: 'PRODUCTION' }, createdAt: { gte: since } },
      select: { createdAt: true, completedAt: true },
    }),
  ])

  // Lead time: first sign of the work in git → the production deploy that shipped it.
  const leadTimes: number[] = []
  for (const deployment of deployments) {
    for (const { ticket } of deployment.tickets) {
      const first = ticket.gitRefs[0]?.createdAt
      if (first && first <= deployment.createdAt) leadTimes.push(deployment.createdAt.getTime() - first.getTime())
    }
  }

  const perWeek = deployments.length / (days / 7)
  const lead = median(leadTimes)
  const failureRate = changeFailureRate(
    deployments.map((deployment) => deployment.createdAt),
    incidents.map((incident) => incident.createdAt),
  )
  const recovery = median(
    incidents.filter((incident) => incident.completedAt).map((incident) => incident.completedAt!.getTime() - incident.createdAt.getTime()),
  )

  // Weekly deploy counts, oldest first, for the small table.
  const weeks: Array<{ start: Date; count: number }> = []
  const weekCount = Math.min(13, Math.ceil(days / 7))
  for (let index = weekCount - 1; index >= 0; index--) {
    const start = new Date(Date.now() - (index + 1) * 7 * 86_400_000)
    const end = new Date(start.getTime() + 7 * 86_400_000)
    weeks.push({ start, count: deployments.filter((deployment) => deployment.createdAt >= start && deployment.createdAt < end).length })
  }

  const band = <T,>(value: T | null, rate: (value: T) => DoraBand) => (value === null ? null : rate(value))
  return {
    days,
    hasRepos: repoIds.length > 0,
    deployments: deployments.length,
    frequency: { perWeek, band: deployments.length ? frequencyBand(perWeek) : null },
    leadTime: { ms: lead, samples: leadTimes.length, band: band(lead, leadTimeBand) },
    failureRate: { rate: failureRate, incidents: incidents.length, band: band(failureRate, failureRateBand) },
    recovery: { ms: recovery, resolved: incidents.filter((incident) => incident.completedAt).length, band: band(recovery, recoveryBand) },
    weeks,
  }
}

export type DeliveryMetrics = Awaited<ReturnType<typeof getDeliveryMetrics>>
