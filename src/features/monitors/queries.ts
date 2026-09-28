import { prisma } from '@/infrastructure/db/prisma'
import { uptimePercent } from '@/core/domain/network'

/** A project's monitors with 24-hour and 7-day uptime, for its settings. */
export async function getProjectMonitors(projectId: string) {
  const monitors = await prisma.monitor.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })
  const since = new Date(Date.now() - 7 * 86_400_000)
  const day = Date.now() - 86_400_000
  const checks = await prisma.monitorCheck.findMany({
    where: { monitorId: { in: monitors.map((monitor) => monitor.id) }, checkedAt: { gte: since } },
    select: { monitorId: true, ok: true, checkedAt: true },
  })
  return monitors.map((monitor) => {
    const own = checks.filter((check) => check.monitorId === monitor.id)
    return {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      state: monitor.state,
      lastLatencyMs: monitor.lastLatencyMs,
      lastError: monitor.lastError,
      lastCheckedAt: monitor.lastCheckedAt,
      intervalMinutes: monitor.intervalMinutes,
      uptime24h: uptimePercent(own.filter((check) => check.checkedAt.getTime() >= day)),
      uptime7d: uptimePercent(own),
      incidentTicketId: monitor.incidentTicketId,
    }
  })
}

export type ProjectMonitors = Awaited<ReturnType<typeof getProjectMonitors>>
