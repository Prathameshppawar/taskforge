import { prisma } from '@/infrastructure/db/prisma'
import { isEmailConfigured } from '@/infrastructure/email/mailer'
import { monthStart, projectMonth } from '@/core/domain/ai-budget'
import { ENGINE_META, getWorkspaceSetting, listAvailableModels, listEngines } from './engines'
import { listBudgets } from './budgets'
import { dailyUsage, usageReport } from './reports'
import { PRICE_CATALOG_PAGE } from './pricing'
import { getAgentRoster } from '@/features/agents/queries'

/** Everything Workspace → AI shows, in one pass. */
export async function getAiAdminPage() {
  const now = new Date()
  const [engines, workspace, prices, budgets, month, last30, subscriptions, users, teams, projects, agents] =
    await Promise.all([
      listEngines(),
      getWorkspaceSetting(),
      prisma.aiModelPrice.findMany({ orderBy: [{ provider: 'asc' }, { model: 'asc' }] }),
      listBudgets(),
      usageReport(monthStart(now), new Date(now.getTime() + 60_000)),
      usageReport(new Date(now.getTime() - 30 * 86_400_000), new Date(now.getTime() + 60_000)),
      prisma.reportSubscription.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          user: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true, _count: { select: { members: true } } } },
        },
      }),
      prisma.user.findMany({ where: { isActive: true, isAgent: false }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.project.findMany({ where: { isArchived: false }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      getAgentRoster(),
    ])
  const [monthDays, last30Days] = await Promise.all([
    dailyUsage(monthStart(now), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))),
    dailyUsage(new Date(now.getTime() - 29 * 86_400_000), new Date(now.getTime() + 86_400_000)),
  ])

  // Model lists are fetched live from each provider that has a key, in parallel.
  const models = Object.fromEntries(
    await Promise.all(engines.map(async (engine) => [engine.id, await listAvailableModels(engine.id)] as const)),
  )

  return {
    engines: engines.map((engine) => ({
      ...engine,
      keysUrl: ENGINE_META[engine.id].keysUrl,
      envKey: ENGINE_META[engine.id].envKey,
      models: models[engine.id],
    })),
    workspace: { copilotProvider: workspace.copilotProvider, fixProvider: workspace.fixProvider },
    prices: prices.map((price) => ({
      provider: price.provider,
      model: price.model,
      inputPerMTok: Number(price.inputPerMTok),
      outputPerMTok: Number(price.outputPerMTok),
      source: price.source,
      updatedAt: price.updatedAt,
      customInputPerMTok: price.customInputPerMTok === null ? null : Number(price.customInputPerMTok),
      customOutputPerMTok: price.customOutputPerMTok === null ? null : Number(price.customOutputPerMTok),
    })),
    budgets,
    month,
    last30,
    subscriptions,
    users,
    teams,
    projects,
    emailConfigured: isEmailConfigured(),
    daily: { month: monthDays, last30: last30Days },
    projection: {
      actual: projectMonth(month.total.costUsd, now),
      list: projectMonth(month.total.listCostUsd, now),
      tokens: projectMonth(month.total.inputTokens + month.total.outputTokens, now),
    },
    priceCatalogPage: PRICE_CATALOG_PAGE,
    agents,
  }
}

export type AiAdminPage = Awaited<ReturnType<typeof getAiAdminPage>>
