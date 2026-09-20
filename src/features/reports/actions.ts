'use server'

import { requirePermission } from '@/features/auth/guards'
import { isAiEnabled } from '@/lib/env'
import { AiProviderError, getAiProvider } from '@/infrastructure/ai'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { factsToPrompt, gatherFacts, isQuietPeriod, type ReportFacts } from './service'

export interface StatusReport {
  prose: string
  facts: ReportFacts
}

const SYSTEM_PROMPT = [
  'You write a short weekly project update for a client or a manager.',
  'You are given facts that were counted from the database. Use only those facts.',
  // The one instruction that matters: everything else is style.
  'Never state a number, ticket key or name that is not in the facts. If a section has none, say so plainly or omit it.',
  'Three short paragraphs at most: what got done, what is in flight, what needs attention.',
  'Write plain prose a non-technical reader can follow. No bullet lists, no headings, no markdown.',
  'Name tickets by key only when it helps the reader act. Do not list every key.',
  'Be honest about risk. If nothing is overdue or blocked, say the work is on track rather than inventing a concern.',
].join('\n')

/**
 * Generates the weekly update.
 *
 * The facts are returned alongside the prose so the UI can show what the report
 * was written from — a generated paragraph nobody can check against its source
 * is one nobody should send.
 */
export async function generateStatusReportAction(
  projectId: string,
  periodDays = 7,
): Promise<ActionResult<StatusReport>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:use')

    const facts = await gatherFacts(actor, projectId, periodDays)

    // Nothing happened, so nothing is sent to the model — a paragraph about an
    // empty week costs tokens to produce and says less than one sentence.
    if (isQuietPeriod(facts)) {
      return ok({
        prose: `No activity on ${facts.projectName} in the last ${periodDays} days.`,
        facts,
      })
    }

    if (!isAiEnabled()) {
      return fail('The AI Copilot is not configured.', { code: 'AI_DISABLED' })
    }

    try {
      const provider = getAiProvider()
      const response = await provider.chat({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: factsToPrompt(facts) },
        ],
        temperature: 0.3,
      })

      const prose = response.content.trim()
      if (!prose) return fail('The report came back empty. Try again.')

      return ok({ prose, facts })
    } catch (error) {
      if (error instanceof AiProviderError) return fail(error.message, { code: error.kind })
      throw error
    }
  })
}
