import type { GitCheckState, TicketKind } from '@prisma/client'

/**
 * When a pull request may be merged without a person.
 *
 * The one place autonomy can outrun verification, so the rule is a list of
 * conditions that must *all* hold, each checked here and each reported by name
 * when it does not — "why didn't it merge?" always has an answer. Nothing here
 * can be satisfied by the model's say-so alone: CI must have run and passed,
 * and the Reviewer (a separate call) must have found nothing.
 */

export interface AutoMergeInput {
  enabled: boolean
  allowedKinds: readonly TicketKind[]
  maxLines: number
  ticketKind: TicketKind
  /** Opened by TaskForge's Coder. A person's pull request is never auto-merged. */
  openedByAi: boolean
  isDraft: boolean
  checkState: GitCheckState | null
  /** How many checks ran. Zero checks is "no CI", not "passed". */
  checkCount: number
  reviewVerdict: string | null
  additions: number
  deletions: number
  files: readonly string[]
}

export function evaluateAutoMerge(input: AutoMergeInput): { merge: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!input.enabled) reasons.push('auto-merge is off for this project')
  if (!input.openedByAi) reasons.push('only pull requests the Coder opened are auto-merged')
  if (input.isDraft) reasons.push('it is still a draft')
  if (input.checkCount === 0) reasons.push('no CI ran on it')
  else if (input.checkState !== 'SUCCESS') reasons.push('its checks have not all passed')
  if (input.reviewVerdict !== 'looks_good') reasons.push('the Reviewer has not said it looks good')
  if (input.additions + input.deletions > input.maxLines) {
    reasons.push(`it changes ${input.additions + input.deletions} lines, above the ${input.maxLines}-line limit`)
  }
  if (input.files.some((file) => /^\.github\/workflows\//i.test(file))) reasons.push('it touches a CI workflow')
  if (!input.allowedKinds.includes(input.ticketKind)) {
    reasons.push(`${input.ticketKind.toLowerCase()} tickets are not in the auto-merge list`)
  }
  return { merge: reasons.length === 0, reasons }
}

export function parseKinds(value: string): TicketKind[] {
  const known: TicketKind[] = ['TASK', 'FEATURE', 'ENHANCEMENT', 'BUG', 'PRODUCTION', 'DEPLOYMENT', 'RESEARCH']
  return value
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part): part is TicketKind => (known as string[]).includes(part))
}
