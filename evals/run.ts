import 'dotenv/config'

import {
  getAiProvider,
  AiProviderError,
  type AiUsage,
  type AiMessage,
} from '@/infrastructure/ai'
import { buildSystemPrompt } from '@/features/ai/service'
import {
  getToolDefinitions,
  TOOL_SCHEMAS,
  isToolName,
  MUTATING_TOOLS,
} from '@/features/ai/tools'
import type { Actor } from '@/features/auth/guards'
import { CASES, type EvalCase, type Group } from './cases'

/**
 * Copilot evaluation suite.
 *
 * `npm run verify` proves the tool *contracts* are sound — the schemas are
 * valid, the payload fits the token budget, arguments are validated before use.
 * None of that says whether the model picks the right tool when a person types
 * a sentence, which is the part that actually decides whether the feature is
 * any good.
 *
 * So this runs the real system prompt and the real tool definitions against the
 * configured model and grades what comes back. It stops at the tool call and
 * never executes one, so it is safe to run against a production key.
 *
 *   npm run eval:ai              one pass
 *   npm run eval:ai -- --repeat 3   three passes, to expose non-determinism
 */

const REPEAT = (() => {
  const index = process.argv.indexOf('--repeat')
  const value = index >= 0 ? Number(process.argv[index + 1]) : 1
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
})()

/*
 * Groq's free tier allows 8,000 tokens per minute. A full pass costs several
 * times that, so the runner paces itself rather than failing half way through
 * and reporting a model problem that is really a rate limit.
 */
const TPM_BUDGET = 7_000
const PRICE_PER_M_INPUT = 0.15
const PRICE_PER_M_OUTPUT = 0.6

const ACTOR: Actor = {
  id: 'eval-actor',
  username: 'prathamesh',
  name: 'Prathamesh Pawar',
  role: 'ADMIN',
  avatarColor: 'blue',
  mustChangePassword: false,
}

interface Outcome {
  case: EvalCase
  pass: boolean
  detail: string
  /** Every tool the model reached for, in order — printed when a case fails. */
  sequence: string[]
  /** Provider round trips this case cost. One user message can need several. */
  rounds: number
  usage?: AiUsage
}

/*
 * The Copilot is a loop, not a single call: the model may read before it
 * writes, see what came back, and only then act. The system prompt tells it to
 * check for duplicates before creating anything, so grading the first tool call
 * alone marks correct behaviour as a failure.
 *
 * The loop is reproduced here with stubbed tool results, so a case asserts what
 * the model eventually does rather than what it happens to reach for first.
 */
const MAX_ROUNDS = 3

/** Neutral results — enough shape to continue, no content to lead the model. */
function stubResult(name: string): string {
  switch (name) {
    case 'find_duplicates':
      return 'No similar tickets found.'
    case 'search_tickets':
      return '1 match: RC-14 "Tablet sync fails offline" (In Progress, High, assignee prakhar).'
    case 'project_insights':
      return 'Regency Ceramics (RC): 14 tickets, 3 done, 2 blocked, 1 overdue.'
    default:
      return 'Done.'
  }
}

class RateGate {
  private spent = 0
  private windowStart = Date.now()

  async take(estimate: number) {
    const elapsed = Date.now() - this.windowStart
    if (elapsed >= 60_000) {
      this.spent = 0
      this.windowStart = Date.now()
      return
    }
    if (this.spent + estimate <= TPM_BUDGET) return

    const wait = 60_000 - elapsed + 500
    process.stdout.write(`    (pausing ${Math.ceil(wait / 1000)}s for the token window)\n`)
    await new Promise((resolve) => setTimeout(resolve, wait))
    this.spent = 0
    this.windowStart = Date.now()
  }

  record(usage?: AiUsage) {
    this.spent += usage?.totalTokens ?? 1_500
  }
}

async function runCase(testCase: EvalCase, gate: RateGate): Promise<Outcome> {
  const provider = getAiProvider()
  const tools = getToolDefinitions()

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt({
        actor: ACTOR,
        projectId: 'eval-project',
        projectName: 'Regency Ceramics',
        projectCode: 'RC',
        screen: testCase.screen,
      }),
    },
    { role: 'user', content: testCase.prompt },
  ]

  const sequence: string[] = []
  let rounds = 0
  let promptTokens = 0
  let completionTokens = 0

  const usage = (): AiUsage => ({
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    await gate.take(1_600)

    let response
    try {
      rounds++
      response = await provider.chat({ messages, tools })
    } catch (error) {
      if (error instanceof AiProviderError && error.kind === 'rate_limited') {
        const wait = (error.retryAfterSeconds ?? 20) * 1000 + 500
        process.stdout.write(`    (rate limited, retrying in ${Math.ceil(wait / 1000)}s)\n`)
        await new Promise((resolve) => setTimeout(resolve, wait))
        round--
        continue
      }
      return {
        case: testCase,
        pass: false,
        detail: error instanceof Error ? error.message : 'provider failed',
        sequence,
        rounds,
      }
    }

    gate.record(response.usage)
    promptTokens += response.usage?.promptTokens ?? 0
    completionTokens += response.usage?.completionTokens ?? 0

    if (response.toolCalls.length === 0) break

    for (const call of response.toolCalls) {
      sequence.push(call.name)

      // A case expecting restraint fails the moment anything would be written.
      if (testCase.tool === null && isToolName(call.name) && MUTATING_TOOLS.has(call.name)) {
        return {
          case: testCase,
          pass: false,
          detail: `called the mutating tool ${call.name}, expected it to decline`,
          sequence,
          rounds,
          usage: usage(),
        }
      }

      if (call.name === testCase.tool) {
        if (isToolName(call.name)) {
          // The same validation the app runs before executing anything.
          const parsed = TOOL_SCHEMAS[call.name].safeParse(call.arguments)
          if (!parsed.success) {
            return {
              case: testCase,
              pass: false,
              detail: `arguments failed validation: ${parsed.error.issues
                .map((issue) => issue.path.join('.'))
                .join(', ')}`,
              sequence,
              rounds,
              usage: usage(),
            }
          }
        }

        const problem = testCase.args?.(call.arguments)
        return problem
          ? { case: testCase, pass: false, detail: problem, sequence, rounds, usage: usage() }
          : { case: testCase, pass: true, detail: 'ok', sequence, rounds, usage: usage() }
      }
    }

    // Not there yet — feed the results back and let the model continue.
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    })
    for (const call of response.toolCalls) {
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: stubResult(call.name),
      })
    }
  }

  if (testCase.tool === null) {
    return {
      case: testCase,
      pass: true,
      detail: sequence.length ? `read only (${sequence.join(' → ')})` : 'declined, as expected',
      sequence,
      rounds,
      usage: usage(),
    }
  }

  return {
    case: testCase,
    pass: false,
    detail: sequence.length
      ? `never called ${testCase.tool} — went ${sequence.join(' → ')}`
      : `no tool call (expected ${testCase.tool})`,
    sequence,
    rounds,
    usage: usage(),
  }
}

function bar(ratio: number, width = 16): string {
  const filled = Math.round(ratio * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

async function main() {
  let provider
  try {
    provider = getAiProvider()
  } catch {
    console.log('\nNo AI provider configured. Set AI_PROVIDER and GROQ_API_KEY to run the evals.\n')
    process.exit(0)
  }

  console.log(`\nCopilot evals — ${provider.id}/${provider.model}`)
  console.log(`${CASES.length} cases x ${REPEAT} pass${REPEAT === 1 ? '' : 'es'}\n`)

  const gate = new RateGate()
  const results = new Map<string, Outcome[]>()
  let promptTokens = 0
  let completionTokens = 0
  let providerCalls = 0

  for (let pass = 1; pass <= REPEAT; pass++) {
    if (REPEAT > 1) console.log(`  pass ${pass}/${REPEAT}`)

    for (const testCase of CASES) {
      const outcome = await runCase(testCase, gate)
      const list = results.get(testCase.id) ?? []
      list.push(outcome)
      results.set(testCase.id, list)

      promptTokens += outcome.usage?.promptTokens ?? 0
      completionTokens += outcome.usage?.completionTokens ?? 0
      providerCalls += outcome.rounds

      console.log(`    ${outcome.pass ? '✓' : '✗'} ${testCase.id.padEnd(28)} ${outcome.pass ? '' : outcome.detail}`)
    }
  }

  // ------------------------------------------------------------- scorecard
  const groups: Group[] = ['routing', 'extraction', 'grounding', 'safety']
  console.log('\n  ── Scorecard ──\n')

  let totalPass = 0
  let totalRun = 0

  for (const group of groups) {
    const inGroup = CASES.filter((c) => c.group === group)
    let passes = 0
    let runs = 0
    for (const testCase of inGroup) {
      for (const outcome of results.get(testCase.id) ?? []) {
        runs++
        if (outcome.pass) passes++
      }
    }
    totalPass += passes
    totalRun += runs
    const ratio = runs ? passes / runs : 0
    console.log(
      `    ${group.padEnd(11)} ${bar(ratio)} ${String(Math.round(ratio * 100)).padStart(3)}%  (${passes}/${runs})`,
    )
  }

  const overall = totalRun ? totalPass / totalRun : 0
  console.log(`\n    ${'overall'.padEnd(11)} ${bar(overall)} ${String(Math.round(overall * 100)).padStart(3)}%  (${totalPass}/${totalRun})`)

  // Cases that did not pass every time they ran — the ones worth looking at.
  const shaky = CASES.filter((testCase) => {
    const outcomes = results.get(testCase.id) ?? []
    return outcomes.some((o) => !o.pass)
  })

  if (shaky.length) {
    console.log('\n  ── Needs attention ──\n')
    for (const testCase of shaky) {
      const outcomes = results.get(testCase.id) ?? []
      const passes = outcomes.filter((o) => o.pass).length
      console.log(`    ${testCase.id}  (${passes}/${outcomes.length} passed)`)
      console.log(`      why it matters: ${testCase.rationale}`)
      const failure = outcomes.find((o) => !o.pass)
      if (failure) {
        console.log(`      last failure:   ${failure.detail}`)
        if (failure.sequence.length)
          console.log(`      tools called:   ${failure.sequence.join(' → ')}`)
      }
      console.log()
    }
  }

  // ------------------------------------------------------------------ cost
  const cost =
    (promptTokens / 1_000_000) * PRICE_PER_M_INPUT +
    (completionTokens / 1_000_000) * PRICE_PER_M_OUTPUT
  const totalTokens = promptTokens + completionTokens

  console.log('  ── Cost of this run ──\n')
  console.log(`    user requests      ${totalRun}`)
  console.log(`    provider calls     ${providerCalls}  (a request may need several rounds)`)
  console.log(`    prompt tokens      ${promptTokens.toLocaleString()}`)
  console.log(`    completion tokens  ${completionTokens.toLocaleString()}`)
  // The unit that matters for forecasting spend is the user request, not the
  // round trip: people send messages, and the rounds are an implementation
  // detail they never see.
  console.log(`    per user request   ${Math.round(totalTokens / Math.max(1, totalRun))} tokens`)
  console.log(`    at Groq list price $${cost.toFixed(4)}  ($${PRICE_PER_M_INPUT}/M in, $${PRICE_PER_M_OUTPUT}/M out)`)
  // Input and output are priced four times apart, so this is the measured cost
  // divided by requests — not an average rate applied to total tokens, which
  // would misprice a workload as lopsided as this one (10:1 in favour of input).
  console.log(`    → $${(cost / Math.max(1, totalRun)).toFixed(6)} per user request\n`)

  // What the free tier actually affords, in the unit people care about.
  const perRequest = totalTokens / Math.max(1, totalRun)
  console.log('  ── Against Groq\'s free tier ──\n')
  console.log(`    8,000 tokens/min   ≈ ${Math.floor(8_000 / perRequest)} requests per minute, workspace-wide`)
  console.log(`    200,000 tokens/day ≈ ${Math.floor(200_000 / perRequest)} requests per day, workspace-wide\n`)

  process.exit(overall === 1 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
