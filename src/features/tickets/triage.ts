import { prisma } from '@/infrastructure/db/prisma'
import { semanticMatches } from './embeddings'

/**
 * Suggesting a ticket's type, priority and labels from its title.
 *
 * Grounded in what this project has actually done, not in what a model imagines
 * a project like this would do. If the last four tickets about the tablet were
 * Bugs labelled "Tablet application", the fifth almost certainly is too — and
 * that is a fact about the workspace, cheaply available from the embeddings
 * already stored, with no API call and nothing to rate-limit.
 *
 * It says nothing rather than guessing when the project has no history to speak
 * from. A suggestion that is wrong half the time is worse than none, because
 * people accept it anyway.
 */

/** Below this, a "majority" is one ticket agreeing with itself. */
const MIN_NEIGHBOURS = 3

/** A suggestion needs this share of neighbours to agree before it is offered. */
const AGREEMENT = 0.5

export interface Agreement<T> {
  value: T
  /** How many neighbours agreed. */
  count: number
  /** Out of how many. */
  outOf: number
}

/**
 * The value most neighbours agree on, if enough of them do.
 *
 * Pure. Ties resolve to neither — with two candidates equally supported there
 * is no majority, and picking the first is a coin toss dressed as a decision.
 */
export function majority<T extends string>(
  values: readonly (T | null | undefined)[],
  threshold = AGREEMENT,
): Agreement<T> | null {
  const present = values.filter((value): value is T => Boolean(value))
  if (present.length === 0) return null

  const counts = new Map<T, number>()
  for (const value of present) counts.set(value, (counts.get(value) ?? 0) + 1)

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [topValue, topCount] = ranked[0]

  // A tie is not a majority.
  if (ranked.length > 1 && ranked[1][1] === topCount) return null
  if (topCount / present.length < threshold) return null

  return { value: topValue, count: topCount, outOf: present.length }
}

/** Labels carried by at least this share of neighbours. */
export function commonLabels(
  labelSets: readonly (readonly string[])[],
  threshold = AGREEMENT,
): Array<Agreement<string>> {
  if (labelSets.length === 0) return []

  const counts = new Map<string, number>()
  for (const set of labelSets) {
    // Count each label once per ticket, however many times it appears.
    for (const label of new Set(set)) counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count / labelSets.length >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, outOf: labelSets.length }))
}

export interface TriageSuggestion {
  typeId?: string
  typeName?: string
  priorityId?: string
  priorityName?: string
  labelIds: string[]
  labelNames: string[]
  /** How many similar finished tickets this was drawn from. */
  basedOn: number
  /** Human phrasing of the evidence, shown beside the suggestion. */
  evidence: string[]
}

/**
 * Reads the project's own history for tickets resembling this title.
 *
 * Returns null when there is not enough to go on, which the UI treats as
 * "offer nothing" rather than "offer a default".
 */
export async function suggestTriage(
  projectId: string,
  title: string,
  description?: string | null,
): Promise<TriageSuggestion | null> {
  const text = description?.trim() ? `${title}\n\n${description}` : title

  // A looser threshold than duplicate detection: these are neighbours, not
  // duplicates, and the point is to find the shape of similar work.
  const matches = await semanticMatches(projectId, text, 12, 0.5).catch(() => [])
  if (matches.length < MIN_NEIGHBOURS) return null

  const neighbours = await prisma.ticket.findMany({
    where: { id: { in: matches.map((match) => match.id) } },
    select: {
      typeId: true,
      type: { select: { name: true } },
      priorityId: true,
      priority: { select: { name: true } },
      labels: { select: { labelId: true, label: { select: { name: true } } } },
    },
  })

  if (neighbours.length < MIN_NEIGHBOURS) return null

  const typeAgreement = majority(neighbours.map((n) => n.typeId))
  const priorityAgreement = majority(neighbours.map((n) => n.priorityId))
  const labelAgreement = commonLabels(
    neighbours.map((n) => n.labels.map((entry) => entry.labelId)),
  )

  if (!typeAgreement && !priorityAgreement && labelAgreement.length === 0) return null

  const nameFor = {
    type: neighbours.find((n) => n.typeId === typeAgreement?.value)?.type.name,
    priority: neighbours.find((n) => n.priorityId === priorityAgreement?.value)?.priority.name,
  }

  const labelNameById = new Map<string, string>()
  for (const neighbour of neighbours) {
    for (const entry of neighbour.labels) labelNameById.set(entry.labelId, entry.label.name)
  }

  const evidence: string[] = []
  if (typeAgreement && nameFor.type) {
    evidence.push(`${typeAgreement.count} of ${typeAgreement.outOf} similar tickets are ${nameFor.type}`)
  }
  if (priorityAgreement && nameFor.priority) {
    evidence.push(`${priorityAgreement.count} of ${priorityAgreement.outOf} are ${nameFor.priority}`)
  }
  for (const label of labelAgreement.slice(0, 3)) {
    const name = labelNameById.get(label.value)
    if (name) evidence.push(`${label.count} of ${label.outOf} are labelled ${name}`)
  }

  return {
    typeId: typeAgreement?.value,
    typeName: nameFor.type,
    priorityId: priorityAgreement?.value,
    priorityName: nameFor.priority,
    labelIds: labelAgreement.slice(0, 3).map((label) => label.value),
    labelNames: labelAgreement
      .slice(0, 3)
      .map((label) => labelNameById.get(label.value))
      .filter((name): name is string => Boolean(name)),
    basedOn: neighbours.length,
    evidence,
  }
}
