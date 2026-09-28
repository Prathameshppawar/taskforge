import type { AiFeature } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import type { AiChatRequest, AiChatResponse, AiProvider } from '@/infrastructure/ai'
import { BusinessRuleError } from '@/core/domain/errors'
import { costMicros, monthKey, monthStart } from '@/core/domain/ai-budget'

/**
 * The AI usage ledger: one row per model call, written by `metered`.
 *
 * Wrapping the provider rather than instrumenting each feature means a new
 * feature that calls a model is counted without anyone remembering to count
 * it — it only has to be given a metered provider, which is the only kind the
 * resolvers hand out to feature code.
 */

export interface UsageContext {
  feature: AiFeature
  userId?: string | null
  projectId?: string | null
  ticketKey?: string | null
}

/** A provider that records every successful call against `context`. */
export function metered(provider: AiProvider, context: UsageContext): AiProvider {
  return {
    id: provider.id,
    model: provider.model,
    async chat(request: AiChatRequest): Promise<AiChatResponse> {
      const response = await provider.chat(request)
      if (response.usage) {
        // Never block the feature on bookkeeping; a lost row is a smaller
        // problem than a Copilot reply that failed because the ledger did.
        void recordUsage(provider, context, response.usage.promptTokens, response.usage.completionTokens).catch(
          (error) => console.error('[ai-usage] could not record usage:', error),
        )
      }
      return response
    },
  }
}

async function recordUsage(
  provider: AiProvider,
  context: UsageContext,
  inputTokens: number,
  outputTokens: number,
) {
  const price = await prisma.aiModelPrice.findUnique({
    where: { provider_model: { provider: provider.id, model: provider.model } },
    select: { inputPerMTok: true, outputPerMTok: true },
  })

  await prisma.aiUsageEvent.create({
    data: {
      provider: provider.id,
      model: provider.model,
      feature: context.feature,
      userId: context.userId ?? null,
      projectId: context.projectId ?? null,
      ticketKey: context.ticketKey ?? null,
      inputTokens,
      outputTokens,
      costMicros: price
        ? costMicros(inputTokens, outputTokens, Number(price.inputPerMTok), Number(price.outputPerMTok))
        : BigInt(0),
    },
  })

  // Imported lazily: alerts pull in the mailer, which feature code should not
  // load just to make a model call.
  const { checkBudgetAlerts } = await import('./budgets')
  await checkBudgetAlerts({ projectId: context.projectId ?? null, provider: provider.id })
}

/** Spend so far this month, in micro-dollars, for one budget's scope. */
export async function spendThisMonth(scope: {
  projectId?: string | null
  provider?: string | null
}): Promise<bigint> {
  const result = await prisma.aiUsageEvent.aggregate({
    where: {
      createdAt: { gte: monthStart(new Date()) },
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.provider ? { provider: scope.provider } : {}),
    },
    _sum: { costMicros: true },
  })
  return result._sum.costMicros ?? BigInt(0)
}

/**
 * Refuses a new call when a hard-stop budget covering it is already spent.
 * Soft budgets never block — they warn, which is what most teams want from a
 * limit on a tool people are in the middle of using.
 */
export async function assertWithinBudget(scope: { projectId?: string | null; provider: string }) {
  const budgets = await prisma.aiBudget.findMany({
    where: {
      hardStop: true,
      OR: [
        { scope: 'WORKSPACE' },
        ...(scope.projectId ? [{ scope: 'PROJECT' as const, projectId: scope.projectId }] : []),
        { scope: 'PROVIDER', provider: scope.provider },
      ],
    },
  })

  for (const budget of budgets) {
    const spent = await spendThisMonth({
      projectId: budget.scope === 'PROJECT' ? budget.projectId : null,
      provider: budget.scope === 'PROVIDER' ? budget.provider : null,
    })
    const limit = BigInt(Math.round(Number(budget.monthlyLimitUsd) * 1_000_000))
    if (spent >= limit) {
      const what =
        budget.scope === 'WORKSPACE' ? 'The workspace' : budget.scope === 'PROJECT' ? 'This project' : `The ${budget.provider} engine`
      throw new BusinessRuleError(
        `${what} has used its AI budget for ${monthKey(new Date())} ($${Number(budget.monthlyLimitUsd).toFixed(2)}). An administrator can raise it on Workspace → AI.`,
      )
    }
  }
}
