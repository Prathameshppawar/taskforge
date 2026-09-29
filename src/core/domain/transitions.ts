/**
 * What must be true before a ticket enters a status.
 *
 * A status carries requirements; moving a ticket into it by hand checks them
 * and says exactly what is missing. Automation — GitHub moving a ticket on a
 * merge, parent rollup — moves only on evidence and is not held to them.
 */

export const REQUIREMENTS = ['ASSIGNEE', 'ESTIMATE', 'CRITERIA', 'PULL_REQUEST', 'MERGED_PR'] as const
export type BuiltInRequirement = (typeof REQUIREMENTS)[number]

export const REQUIREMENT_LABELS: Record<BuiltInRequirement, { label: string; hint: string }> = {
  ASSIGNEE: { label: 'Has an assignee', hint: 'Someone owns it.' },
  ESTIMATE: { label: 'Is estimated', hint: 'Story points or hours.' },
  CRITERIA: { label: 'Every acceptance criterion is met', hint: 'All boxes ticked.' },
  PULL_REQUEST: { label: 'Has a linked pull request', hint: 'Open, draft or merged.' },
  MERGED_PR: { label: 'Has a merged pull request', hint: 'The change is in.' },
}

export interface TransitionFacts {
  assigneeId: string | null
  storyPoints: number | null
  estimateHours: number | null
  criteria: { total: number; met: number }
  pullRequests: { open: number; merged: number }
  /** Custom field ids with a value. */
  filledFields: Set<string>
  fieldNames: Map<string, string>
}

/** The requirements that are not met, each as a sentence; empty when the move may go ahead. */
export function unmetRequirements(requirements: string[], facts: TransitionFacts): string[] {
  const unmet: string[] = []
  for (const requirement of requirements) {
    switch (requirement) {
      case 'ASSIGNEE':
        if (!facts.assigneeId) unmet.push('it needs an assignee')
        break
      case 'ESTIMATE':
        if (!(facts.storyPoints && facts.storyPoints > 0) && !(facts.estimateHours && facts.estimateHours > 0)) unmet.push('it needs an estimate')
        break
      case 'CRITERIA':
        if (facts.criteria.met < facts.criteria.total) {
          const open = facts.criteria.total - facts.criteria.met
          unmet.push(`${open} acceptance ${open === 1 ? 'criterion is' : 'criteria are'} not met`)
        }
        break
      case 'PULL_REQUEST':
        if (facts.pullRequests.open + facts.pullRequests.merged === 0) unmet.push('it needs a linked pull request')
        break
      case 'MERGED_PR':
        if (facts.pullRequests.merged === 0) unmet.push('its pull request is not merged')
        break
      default:
        if (requirement.startsWith('FIELD:')) {
          const id = requirement.slice(6)
          // A requirement on a field that no longer exists is not held against anyone.
          if (facts.fieldNames.has(id) && !facts.filledFields.has(id)) unmet.push(`${facts.fieldNames.get(id)} must be filled in`)
        }
    }
  }
  return unmet
}

/** "Done needs: it needs an assignee and 2 acceptance criteria are not met." */
export function describeUnmet(statusName: string, unmet: string[]): string {
  const list = unmet.length <= 1 ? unmet.join('') : `${unmet.slice(0, -1).join(', ')} and ${unmet.at(-1)}`
  return `${statusName} can’t be reached yet: ${list}.`
}
