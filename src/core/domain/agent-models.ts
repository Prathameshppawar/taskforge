/**
 * Which model suits which agent, from facts rather than taste.
 *
 * Each agent has a specialty and so a profile: what it cannot do without
 * (tool calling, a large enough context), and how much it cares about
 * reasoning, context, capability and cost. Candidates are the models of the
 * engines a workspace has actually connected, scored against that profile.
 *
 * The inputs are what can be cited: the public catalogue's capability flags
 * and prices, the workspace's billing plan, and — for the Coder — its own
 * record of pull requests merged versus closed on each engine. Nothing here
 * measures coding quality directly, so list price stands in as a *rough*
 * signal of capability (frontier models are priced as frontier models), every
 * reason that leans on it says so, and real acceptance data outweighs it once
 * there is enough of it.
 */

export type AgentRole = 'copilot' | 'coder' | 'planner' | 'reviewer' | 'release' | 'ops'

interface Weights {
  reasoning: number
  context: number
  capability: number
  cost: number
  /** Only the Coder has an acceptance record to weigh. */
  acceptance?: number
}

export interface AgentProfile {
  role: AgentRole
  label: string
  specialty: string
  /** What it is used for, in the product's own words. */
  usedFor: string
  needsTools: boolean
  minContext: number
  weights: Weights
}

export const AGENT_PROFILES: Record<AgentRole, AgentProfile> = {
  copilot: {
    role: 'copilot',
    label: 'Copilot (chat)',
    specialty: 'Quick, conversational help: answer, find, create and update tickets.',
    usedFor: 'The Copilot panel, capture, describe a view, and the weekly update.',
    needsTools: true,
    minContext: 16_000,
    weights: { reasoning: 0.1, context: 0.1, capability: 0.1, cost: 0.7 },
  },
  coder: {
    role: 'coder',
    label: 'TaskForge Coder',
    specialty: 'Reads a repository and writes working changes through tools, over many steps.',
    usedFor: 'Fix with AI, healing failing CI, and scaffolding new repositories.',
    needsTools: true,
    minContext: 64_000,
    weights: { reasoning: 0.25, context: 0.15, capability: 0.3, cost: 0.1, acceptance: 0.2 },
  },
  planner: {
    role: 'planner',
    label: 'TaskForge Planner',
    specialty: 'Reads the code and reasons about how a change should be made, before anyone builds it.',
    usedFor: 'Plan first.',
    needsTools: true,
    minContext: 64_000,
    weights: { reasoning: 0.35, context: 0.2, capability: 0.3, cost: 0.15 },
  },
  reviewer: {
    role: 'reviewer',
    label: 'TaskForge Reviewer',
    specialty: 'Reads a whole diff against its ticket and finds what is wrong with it.',
    usedFor: 'AI review, and the automatic review of every AI pull request.',
    needsTools: true,
    minContext: 64_000,
    weights: { reasoning: 0.3, context: 0.3, capability: 0.25, cost: 0.15 },
  },
  release: {
    role: 'release',
    label: 'TaskForge Release Manager',
    specialty: 'Plain-language writing for clients, from a list of finished tickets.',
    usedFor: 'Release notes.',
    needsTools: true,
    minContext: 16_000,
    weights: { reasoning: 0.1, context: 0.1, capability: 0.2, cost: 0.6 },
  },
  ops: {
    role: 'ops',
    label: 'TaskForge Ops',
    specialty: 'Careful, factual reasoning over an incident record.',
    usedFor: 'Post-mortems.',
    needsTools: false,
    minContext: 32_000,
    weights: { reasoning: 0.3, context: 0.2, capability: 0.2, cost: 0.3 },
  },
}

export const AGENT_ROLES = Object.keys(AGENT_PROFILES) as AgentRole[]

export interface ModelCandidate {
  engineId: string
  engineLabel: string
  model: string
  /** The engine is on a free tier for this workspace. */
  free: boolean
  inputPerMTok: number | null
  outputPerMTok: number | null
  supportsTools: boolean | null
  supportsReasoning: boolean | null
  contextTokens: number | null
  /** The Coder's record on this engine: merged ÷ decided pull requests. */
  acceptance?: { rate: number; decided: number } | null
}

export interface Recommendation {
  candidate: ModelCandidate
  eligible: boolean
  score: number
  reasons: string[]
}

/** Pull requests decided before an acceptance rate counts as evidence. */
export const MIN_DECIDED = 3

/** Blended $ per million tokens, weighting input 3:1 as agent work does. */
function blended(candidate: ModelCandidate): number | null {
  if (candidate.inputPerMTok === null || candidate.outputPerMTok === null) return null
  return (candidate.inputPerMTok * 3 + candidate.outputPerMTok) / 4
}

export function scoreCandidate(role: AgentRole, candidate: ModelCandidate): Recommendation {
  const profile = AGENT_PROFILES[role]
  const reasons: string[] = []

  if (profile.needsTools && candidate.supportsTools === false) {
    return { candidate, eligible: false, score: 0, reasons: ['cannot call tools, which this agent works through'] }
  }
  if (candidate.contextTokens !== null && candidate.contextTokens < profile.minContext) {
    return { candidate, eligible: false, score: 0, reasons: [`context of ${Math.round(candidate.contextTokens / 1000)}k is too small for this agent`] }
  }

  const price = blended(candidate)
  const parts: Array<{ weight: number; value: number }> = []

  const reasoning = candidate.supportsReasoning === true ? 1 : candidate.supportsReasoning === null ? 0.5 : 0
  parts.push({ weight: profile.weights.reasoning, value: reasoning })
  if (candidate.supportsReasoning === true) reasons.push('reasoning model')

  const context = candidate.contextTokens === null ? 0.5 : Math.min(candidate.contextTokens / 200_000, 1)
  parts.push({ weight: profile.weights.context, value: context })
  if (candidate.contextTokens !== null) reasons.push(`${candidate.contextTokens >= 1_000_000 ? `${Math.round(candidate.contextTokens / 1_000_000)}M` : `${Math.round(candidate.contextTokens / 1000)}k`} context`)

  // Capability, from list price: ~$10 blended per million scores 1.
  const capability = price === null ? 0.3 : Math.min(Math.log10(1 + price * 10) / 2, 1)
  parts.push({ weight: profile.weights.capability, value: capability })
  const list = price === null ? null : `$${candidate.inputPerMTok}/$${candidate.outputPerMTok} per million`

  const cost = candidate.free ? 1 : price === null ? 0.4 : 1 / (1 + price)
  parts.push({ weight: profile.weights.cost, value: cost })
  // The list price is always stated, labelled for what it is used as: when two
  // models share every other fact, it is what separates them, and a ranking
  // whose deciding factor is hidden cannot be judged.
  if (candidate.free) reasons.push(`free tier — costs nothing${list ? ` (list ${list}, a rough capability signal)` : ''}`)
  else if (list) reasons.push(capability >= 0.7 ? `${list} — priced as a frontier model (a rough capability signal)` : `${list}${price! < 1 ? ', cheap' : ''} (a rough capability signal)`)
  else reasons.push('no public price, so capability and cost are unknown')

  if (profile.weights.acceptance && candidate.acceptance && candidate.acceptance.decided >= MIN_DECIDED) {
    // Evidence counts for more the more of it there is: the base weight at
    // three decided pull requests, doubling by thirteen. Twenty merged-or-
    // closed pull requests say more about an engine than its price does.
    const evidence = Math.min(1, (candidate.acceptance.decided - MIN_DECIDED) / 10)
    parts.push({ weight: profile.weights.acceptance * (1 + evidence), value: candidate.acceptance.rate })
    reasons.unshift(`${Math.round(candidate.acceptance.rate * 100)}% of its ${candidate.acceptance.decided} decided pull requests here were merged`)
  }

  // Weights of the parts actually present, so a missing acceptance record
  // neither rewards nor penalises an engine.
  const total = parts.reduce((sum, part) => sum + part.weight, 0)
  const score = parts.reduce((sum, part) => sum + part.weight * part.value, 0) / total
  return { candidate, eligible: true, score: Math.round(score * 1000) / 1000, reasons }
}

/** Eligible candidates, best first. */
export function recommend(role: AgentRole, candidates: ModelCandidate[], limit = 3): Recommendation[] {
  return candidates
    .map((candidate) => scoreCandidate(role, candidate))
    .filter((entry) => entry.eligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
