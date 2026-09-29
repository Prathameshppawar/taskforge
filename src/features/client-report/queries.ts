import { prisma } from '@/infrastructure/db/prisma'
import { microsToUsd } from '@/core/domain/ai-budget'
import { uptimePercent } from '@/core/domain/network'
import { RELEASE_SECTIONS } from '@/core/domain/releases'

/**
 * One project's month, for the client: what was delivered, what shipped,
 * what went wrong and how quickly it was fixed — and, for staff only, what
 * the AI work cost, which is what an agency bills against.
 */
export async function getClientReport(projectId: string, month: string, includeCosts: boolean) {
  const [year, monthIndex] = month.split('-').map(Number)
  const from = new Date(Date.UTC(year, monthIndex - 1, 1))
  const to = new Date(Date.UTC(year, monthIndex, 1))
  const inMonth = { gte: from, lt: to }

  const repos = await prisma.projectRepo.findMany({ where: { projectId }, select: { repoId: true } })
  const repoIds = repos.map((entry) => entry.repoId)

  const [project, delivered, deployments, incidents, monitors, spend] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, code: true } }),
    prisma.ticket.findMany({
      where: { projectId, completedAt: inMonth, status: { category: 'DONE' }, type: { kind: { notIn: ['DEPLOYMENT'] } } },
      orderBy: { completedAt: 'asc' },
      select: { key: true, title: true, type: { select: { kind: true } } },
    }),
    repoIds.length
      ? prisma.deployment.count({ where: { repoId: { in: repoIds }, isProduction: true, state: 'SUCCESS', createdAt: inMonth } })
      : Promise.resolve(0),
    prisma.ticket.findMany({
      where: { projectId, type: { kind: 'PRODUCTION' }, createdAt: inMonth },
      select: { key: true, title: true, createdAt: true, completedAt: true },
    }),
    prisma.monitor.findMany({
      where: { projectId },
      select: { name: true, checks: { where: { checkedAt: inMonth }, select: { ok: true } } },
    }),
    includeCosts
      ? prisma.aiUsageEvent.aggregate({ where: { projectId, createdAt: inMonth }, _sum: { costMicros: true, inputTokens: true, outputTokens: true }, _count: true })
      : Promise.resolve(null),
  ])

  const sections = RELEASE_SECTIONS.map((section) => ({
    title: section.title,
    items: delivered.filter((ticket) => section.kinds.includes(ticket.type.kind)),
  })).filter((section) => section.items.length > 0)

  return {
    project,
    month,
    label: from.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    deliveredCount: delivered.length,
    sections,
    deployments,
    incidents: incidents.map((incident) => ({
      ...incident,
      hoursToFix: incident.completedAt ? Math.round(((incident.completedAt.getTime() - incident.createdAt.getTime()) / 3_600_000) * 10) / 10 : null,
    })),
    uptime: monitors.map((monitor) => ({ name: monitor.name, percent: uptimePercent(monitor.checks), checks: monitor.checks.length })),
    spend: spend
      ? {
          usd: microsToUsd(spend._sum.costMicros ?? BigInt(0)),
          calls: spend._count,
          tokens: (spend._sum.inputTokens ?? 0) + (spend._sum.outputTokens ?? 0),
        }
      : null,
  }
}

export function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}
