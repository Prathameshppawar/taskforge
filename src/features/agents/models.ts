import { prisma } from '@/infrastructure/db/prisma'
import { agentEngine, listAvailableModels, listCodingEngines } from '@/features/ai-admin/engines'
import { AGENT_PROFILES, AGENT_ROLES, recommend, type ModelCandidate } from '@/core/domain/agent-models'

/**
 * For each agent: what it uses now, what the connected engines offer, and the
 * best-suited models among them, with the reasons.
 *
 * Candidates are the models of engines that are ready to use — never an
 * engine the workspace has not connected — joined with the catalogue's
 * capability facts and price, the engine's billing plan, and the Coder's own
 * record of merged versus closed pull requests on each engine.
 */
const MODELS_PER_ENGINE = 40

export async function getAgentModels() {
  const engines = await listCodingEngines()
  const [prices, outcomes, current] = await Promise.all([
    prisma.aiModelPrice.findMany({ where: { provider: { in: engines.map((engine) => engine.id) } } }),
    coderOutcomesByEngine(),
    Promise.all(AGENT_ROLES.map(async (role) => [role, await agentEngine(role)] as const)),
  ])
  const priceOf = new Map(prices.map((row) => [`${row.provider}/${row.model}`, row]))

  const candidates: ModelCandidate[] = []
  const modelsByEngine: Record<string, string[]> = {}
  for (const engine of engines) {
    const { models } = await listAvailableModels(engine.id)
    const list = [...new Set([engine.model, ...models])].slice(0, MODELS_PER_ENGINE)
    modelsByEngine[engine.id] = list
    for (const model of list) {
      const row = priceOf.get(`${engine.id}/${model}`)
      candidates.push({
        engineId: engine.id,
        engineLabel: engine.label,
        model,
        free: engine.billingPlan === 'free',
        inputPerMTok: row && row.source === 'auto' ? Number(row.inputPerMTok) : null,
        outputPerMTok: row && row.source === 'auto' ? Number(row.outputPerMTok) : null,
        supportsTools: row?.supportsTools ?? null,
        supportsReasoning: row?.supportsReasoning ?? null,
        contextTokens: row?.contextTokens ?? null,
        acceptance: outcomes.get(engine.id) ?? null,
      })
    }
  }

  const assignedRows = await prisma.agentSetting.findMany()
  return {
    engines: engines.map((engine) => ({ id: engine.id, label: engine.label, models: modelsByEngine[engine.id] ?? [] })),
    agents: AGENT_ROLES.map((role) => {
      const now = current.find(([key]) => key === role)?.[1] ?? null
      return {
        ...AGENT_PROFILES[role],
        current: now,
        assigned: assignedRows.some((row) => row.agent === role),
        recommendations: recommend(role, candidates, 3).map((entry) => ({
          engineId: entry.candidate.engineId,
          engineLabel: entry.candidate.engineLabel,
          model: entry.candidate.model,
          score: entry.score,
          reasons: entry.reasons,
        })),
      }
    }),
  }
}

export type AgentModels = Awaited<ReturnType<typeof getAgentModels>>

/** The Coder's pull requests by engine: merged ÷ (merged + closed unmerged). */
async function coderOutcomesByEngine(): Promise<Map<string, { rate: number; decided: number }>> {
  const runs = await prisma.aiFixRun.findMany({
    where: { mode: { in: ['FIX', 'SCAFFOLD'] }, status: 'SUCCEEDED', prNumber: { not: null } },
    select: { provider: true, repoId: true, ticketId: true, prNumber: true },
  })
  if (runs.length === 0) return new Map()
  const refs = await prisma.ticketGitRef.findMany({
    where: { kind: 'PULL_REQUEST', state: { in: ['MERGED', 'CLOSED'] }, OR: runs.map((run) => ({ repoId: run.repoId, ticketId: run.ticketId, externalId: String(run.prNumber) })) },
    select: { repoId: true, ticketId: true, externalId: true, state: true },
  })
  const stateOf = new Map(refs.map((ref) => [`${ref.repoId}/${ref.ticketId}/${ref.externalId}`, ref.state]))
  const tally = new Map<string, { merged: number; decided: number }>()
  for (const run of runs) {
    const state = stateOf.get(`${run.repoId}/${run.ticketId}/${run.prNumber}`)
    if (!state) continue
    const row = tally.get(run.provider) ?? { merged: 0, decided: 0 }
    row.decided++
    if (state === 'MERGED') row.merged++
    tally.set(run.provider, row)
  }
  return new Map([...tally].map(([engine, row]) => [engine, { rate: row.merged / row.decided, decided: row.decided }]))
}
