'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requirePermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { AiProviderError } from '@/infrastructure/ai'
import { getEngineProvider, saveEngine } from './engines'
import { engineDefinition, isEngineId } from '@/core/domain/engine-catalog'
import { sendWeeklyUsageReport } from './reports'
import { ensurePrice, refreshModelPrices } from './pricing'

/**
 * Workspace → AI. Every action needs `ai:manage`, and every change that alters
 * cost or who can see spend is written to the audit log.
 */

const engineId = z.string().refine(isEngineId, 'Unknown engine.')
const PATH = '/workspace/ai'

async function audit(actorId: string, summary: string) {
  await recordActivity(prisma, {
    action: 'UPDATED',
    entityType: 'INTEGRATION',
    entityId: 'ai',
    entityLabel: 'AI settings',
    actorId,
    summary,
  })
}

const engineSchema = z.object({
  id: engineId,
  model: z.string().trim().min(1, 'Choose a model.').max(120),
  enabled: z.boolean(),
  billingPlan: z.enum(['free', 'list', 'custom']).default('list'),
  /** Custom engine only: its OpenAI-compatible base URL. */
  baseUrl: z.string().trim().max(300).nullable().optional(),
  /** Omitted: keep the stored key. Empty string: remove it. */
  apiKey: z.string().trim().max(400).optional(),
})

export async function saveEngineAction(input: z.input<typeof engineSchema>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = engineSchema.parse(input)
    try {
    await saveEngine({
      id: data.id,
      model: data.model,
      enabled: data.enabled,
      billingPlan: data.billingPlan,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey === undefined ? undefined : data.apiKey === '' ? null : data.apiKey,
    })
    } catch (error) {
      throw new BusinessRuleError((error as Error).message)
    }
    // A newly chosen model gets its list price straight away, so spend is in
    // dollars from its first call rather than after someone remembers.
    await ensurePrice(data.id, data.model).catch(() => null)
    await audit(
      actor.id,
      `set ${engineDefinition(data.id)?.label ?? data.id} to ${data.model}${data.enabled ? '' : ' (off)'}${
        data.apiKey === undefined ? '' : data.apiKey === '' ? ', removed its key' : ', saved a new key'
      }`,
    )
    revalidatePath(PATH)
    return ok()
  })
}

/** One tiny request, so "does this key and model work?" has an answer before anyone relies on it. */
export async function testEngineAction(id: string): Promise<ActionResult<{ reply: string; ms: number }>> {
  return runAction(async () => {
    await requirePermission('ai:manage')
    const provider = await getEngineProvider(engineId.parse(id))
    const started = Date.now()
    try {
      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        maxTokens: 256,
      })
      return ok({ reply: response.content.trim().slice(0, 80) || '(empty reply)', ms: Date.now() - started })
    } catch (error) {
      if (error instanceof AiProviderError) throw new BusinessRuleError(error.message)
      throw error
    }
  })
}

const workspaceSchema = z.object({
  copilotProvider: z.string().refine((id) => id === 'ollama' || isEngineId(id), 'Unknown engine.').nullable(),
  fixProvider: engineId.nullable(),
})

export async function saveWorkspaceAiAction(input: z.infer<typeof workspaceSchema>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = workspaceSchema.parse(input)
    await prisma.aiWorkspaceSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data })
    await audit(
      actor.id,
      `set the Copilot engine to ${data.copilotProvider ?? 'the environment default'} and Fix with AI to ${data.fixProvider ?? 'the most capable available'}`,
    )
    revalidatePath(PATH)
    return ok()
  })
}

const priceSchema = z.object({
  provider: engineId,
  model: z.string().trim().min(1).max(120),
  inputPerMTok: z.coerce.number().min(0).max(1000),
  outputPerMTok: z.coerce.number().min(0).max(1000),
})

export async function savePriceAction(input: z.infer<typeof priceSchema>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = priceSchema.parse(input)
    // The workspace's own rate, beside the list price — which a refresh keeps
    // current, and which stays the basis of the "at list price" estimate.
    await prisma.aiModelPrice.upsert({
      where: { provider_model: { provider: data.provider, model: data.model } },
      create: {
        provider: data.provider,
        model: data.model,
        inputPerMTok: 0,
        outputPerMTok: 0,
        source: 'manual',
        customInputPerMTok: data.inputPerMTok,
        customOutputPerMTok: data.outputPerMTok,
      },
      update: { customInputPerMTok: data.inputPerMTok, customOutputPerMTok: data.outputPerMTok },
    })
    await audit(actor.id, `set the rate for ${data.provider} ${data.model} to $${data.inputPerMTok}/$${data.outputPerMTok} per million tokens`)
    revalidatePath(PATH)
    return ok()
  })
}

/** Refreshes every list price from the public catalogue; hand-set prices are kept. */
export async function refreshPricesAction(): Promise<ActionResult<{ updated: number; kept: number }>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    try {
      const result = await refreshModelPrices()
      await audit(actor.id, `refreshed ${result.updated} model list prices (${result.kept} set by hand were kept)`)
      revalidatePath(PATH)
      return ok({ updated: result.updated, kept: result.kept })
    } catch (error) {
      throw new BusinessRuleError((error as Error).message)
    }
  })
}

/** Goes back to the list price for one model, dropping a hand-set one. */
export async function revertToListPriceAction(input: { provider: string; model: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = z.object({ provider: engineId, model: z.string().trim().min(1).max(120) }).parse(input)
    await prisma.aiModelPrice.updateMany({
      where: { provider: data.provider, model: data.model },
      data: { customInputPerMTok: null, customOutputPerMTok: null },
    })
    await audit(actor.id, `went back to the list price for ${data.provider} ${data.model}`)
    revalidatePath(PATH)
    return ok()
  })
}

const budgetSchema = z
  .object({
    scope: z.enum(['WORKSPACE', 'PROJECT', 'PROVIDER']),
    projectId: z.string().nullable().optional(),
    provider: engineId.nullable().optional(),
    monthlyLimitUsd: z.coerce.number().positive('Enter a limit above zero.').max(1_000_000),
    hardStop: z.boolean(),
  })
  .refine((value) => value.scope !== 'PROJECT' || value.projectId, { message: 'Choose a project.', path: ['projectId'] })
  .refine((value) => value.scope !== 'PROVIDER' || value.provider, { message: 'Choose a provider.', path: ['provider'] })

export async function saveBudgetAction(input: z.infer<typeof budgetSchema>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = budgetSchema.parse(input)
    const projectId = data.scope === 'PROJECT' ? data.projectId! : null
    const provider = data.scope === 'PROVIDER' ? data.provider! : null

    // Looked up by hand: the unique index treats NULLs as distinct, so it would
    // happily hold two workspace budgets.
    const existing = await prisma.aiBudget.findFirst({ where: { scope: data.scope, projectId, provider } })
    if (existing) {
      await prisma.aiBudget.update({
        where: { id: existing.id },
        data: { monthlyLimitUsd: data.monthlyLimitUsd, hardStop: data.hardStop, lastAlert: null },
      })
    } else {
      await prisma.aiBudget.create({
        data: { scope: data.scope, projectId, provider, monthlyLimitUsd: data.monthlyLimitUsd, hardStop: data.hardStop },
      })
    }
    await audit(
      actor.id,
      `set a ${data.scope.toLowerCase()} AI budget of $${data.monthlyLimitUsd.toFixed(2)} a month${data.hardStop ? ' (hard stop)' : ''}`,
    )
    revalidatePath(PATH)
    return ok()
  })
}

export async function deleteBudgetAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const budget = await prisma.aiBudget.findUnique({ where: { id } })
    if (!budget) throw new NotFoundError('Budget', id)
    await prisma.aiBudget.delete({ where: { id } })
    await audit(actor.id, `removed a ${budget.scope.toLowerCase()} AI budget`)
    revalidatePath(PATH)
    return ok()
  })
}

const subscriptionSchema = z
  .object({
    kind: z.enum(['AI_USAGE_WEEKLY', 'AI_BUDGET_ALERT']),
    userId: z.string().nullable().optional(),
    teamId: z.string().nullable().optional(),
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.teamId), { message: 'Choose a person or a team.' })

export async function subscribeAction(input: z.infer<typeof subscriptionSchema>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = subscriptionSchema.parse(input)
    await prisma.reportSubscription.create({
      data: { kind: data.kind, userId: data.userId || null, teamId: data.teamId || null, createdById: actor.id },
    })
    await audit(actor.id, `subscribed a ${data.userId ? 'person' : 'team'} to ${data.kind.toLowerCase().replace(/_/g, ' ')}`)
    revalidatePath(PATH)
    return ok()
  })
}

export async function unsubscribeAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePermission('ai:manage')
    await prisma.reportSubscription.delete({ where: { id } })
    revalidatePath(PATH)
    return ok()
  })
}

export async function sendReportNowAction(): Promise<ActionResult<{ recipients: number }>> {
  return runAction(async () => {
    await requirePermission('ai:manage')
    const result = await sendWeeklyUsageReport()
    if (!result.sent) throw new BusinessRuleError(result.reason ?? 'The report was not sent.')
    return ok({ recipients: result.recipients })
  })
}

const agentSchema = z.object({
  agent: z.enum(['copilot', 'coder', 'planner', 'reviewer', 'release', 'ops']),
  engineId: z.string().refine(isEngineId, 'Unknown engine.').nullable(),
  model: z.string().trim().max(160).nullable(),
})

/** Gives one agent its own engine and model, or (null) returns it to the workspace default. */
export async function setAgentModelAction(input: z.infer<typeof agentSchema>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:manage')
    const data = agentSchema.parse(input)
    if (!data.engineId || !data.model) {
      await prisma.agentSetting.deleteMany({ where: { agent: data.agent } })
      await audit(actor.id, `returned the ${data.agent} agent to the workspace default engine`)
    } else {
      await prisma.agentSetting.upsert({
        where: { agent: data.agent },
        create: { agent: data.agent, engineId: data.engineId, model: data.model },
        update: { engineId: data.engineId, model: data.model },
      })
      await ensurePrice(data.engineId, data.model).catch(() => null)
      await audit(actor.id, `set the ${data.agent} agent to ${engineDefinition(data.engineId)?.label ?? data.engineId} · ${data.model}`)
    }
    revalidatePath(PATH)
    return ok()
  })
}
