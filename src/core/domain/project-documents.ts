/**
 * Project documents and the proposals that change them.
 *
 * A project keeps the handbook and any number of named documents (Overview,
 * Architecture, a support runbook…). Each is identified by a key: `HANDBOOK`
 * for the handbook, otherwise a slug of its name. Every version is kept.
 *
 * Agents do not write documents or project details directly: they propose,
 * and a project manager approves. The rules for naming a document, telling
 * whether a proposal has been overtaken, and showing what it changes live
 * here so they can be asserted without a database.
 */

export const HANDBOOK_KEY = 'HANDBOOK'

/** Long enough for any sensible name, short enough to sit in a URL. */
const MAX_KEY_LENGTH = 60

/**
 * The key a document name refers to: "Functional Flows" → `functional-flows`.
 * "Handbook" (in any case) is the handbook. Null when nothing usable remains.
 */
export function documentKey(name: string): string | null {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/-+$/, '')
  if (!slug) return null
  return slug === 'handbook' || slug === 'project-handbook' ? HANDBOOK_KEY : slug
}

/** A readable title for a key, used when a new document is proposed without one. */
export function titleFromKey(key: string): string {
  if (key === HANDBOOK_KEY) return 'Handbook'
  const words = key.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The documents most projects end up wanting; offered when starting one. */
export const SUGGESTED_DOCUMENTS = [
  { key: 'overview', title: 'Overview' },
  { key: 'architecture', title: 'Architecture' },
  { key: 'functional-flows', title: 'Functional flows' },
  { key: 'technical-decisions', title: 'Technical decisions' },
  { key: 'support-runbook', title: 'Support runbook' },
] as const

/** How each version came about, as the document pages say it. */
export const DOCUMENT_SOURCE_LABELS: Record<string, string> = {
  AI: 'Written by the Release Manager',
  FACTS: 'Assembled from the recorded facts',
  EDIT: 'Edited',
  PROPOSAL: 'From an approved proposal',
}

/** Bounds shared by the editor, the proposal tools and the approval path. */
export const DOCUMENT_LIMITS = { titleMax: 120, bodyMin: 20, bodyMax: 100_000 } as const

// -----------------------------------------------------------------------------
// Project details proposals
// -----------------------------------------------------------------------------

/** Statuses a proposal may set. Archiving is an administrative act, never proposed. */
export const PROPOSABLE_PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as const

export const PROJECT_DETAIL_FIELDS = ['description', 'status', 'startDate', 'endDate'] as const
export type ProjectDetailField = (typeof PROJECT_DETAIL_FIELDS)[number]

/** The proposable details, normalised: dates as YYYY-MM-DD, absence as null. */
export type ProjectDetailValues = Record<ProjectDetailField, string | null>

export const PROJECT_DETAIL_LABELS: Record<ProjectDetailField, string> = {
  description: 'Description',
  status: 'Status',
  startDate: 'Start date',
  endDate: 'End date',
}

/** A project's current details in the shape proposals are written in. */
export function detailValues(project: {
  description: string | null
  status: string
  startDate: Date | null
  endDate: Date | null
}): ProjectDetailValues {
  return {
    description: project.description?.trim() ? project.description : null,
    status: project.status,
    startDate: project.startDate ? project.startDate.toISOString().slice(0, 10) : null,
    endDate: project.endDate ? project.endDate.toISOString().slice(0, 10) : null,
  }
}

export interface DetailChange {
  field: ProjectDetailField
  from: string | null
  to: string | null
}

/** What a details proposal would change, field by field, against `current`. */
export function detailChanges(
  current: ProjectDetailValues,
  proposed: Partial<ProjectDetailValues>,
): DetailChange[] {
  return PROJECT_DETAIL_FIELDS.filter((field) => field in proposed && proposed[field] !== undefined)
    .map((field) => ({ field, from: current[field], to: proposed[field] ?? null }))
    .filter((change) => (change.from ?? '') !== (change.to ?? ''))
}

/**
 * The proposed fields that someone has changed since the proposal was written.
 * Only those fields matter: an edit to the dates does not overtake a proposal
 * that only rewrites the description.
 */
export function staleDetailFields(
  base: Partial<ProjectDetailValues>,
  current: ProjectDetailValues,
): ProjectDetailField[] {
  return PROJECT_DETAIL_FIELDS.filter(
    (field) => field in base && (base[field] ?? null) !== (current[field] ?? null),
  )
}

/** A document proposal is stale once the document has moved past the version it read. */
export function isDocumentStale(baseVersion: number | null, latestVersion: number): boolean {
  return baseVersion != null && latestVersion !== baseVersion
}

// -----------------------------------------------------------------------------
// Line diff, for reviewing a proposed document against the current one
// -----------------------------------------------------------------------------

export type DiffLine = { op: 'same' | 'add' | 'remove'; text: string }

/**
 * Past this many cells the LCS table costs more than a review page should
 * spend; the changed middle is then shown as removed-then-added, which is still
 * correct, only less precise.
 */
const MAX_DIFF_CELLS = 4_000_000

/**
 * A line diff of two texts. Common leading and trailing lines are matched
 * first, so the usual proposal — a few paragraphs changed in a long document —
 * runs the quadratic part only over the changed middle.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  if (before === '') a.length = 0
  if (after === '') b.length = 0

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ op: 'same', text }))
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ op: 'same', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ op: 'remove', text })),
      ...midB.map((text): DiffLine => ({ op: 'add', text })),
      ...tail,
    ]
  }

  // lengths[i][j]: the longest common subsequence of midA[i..] and midB[j..].
  const width = midB.length + 1
  const lengths = new Uint32Array((midA.length + 1) * width)
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        midA[i] === midB[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
    }
  }

  const middle: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ op: 'same', text: midA[i] })
      i++
      j++
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      middle.push({ op: 'remove', text: midA[i++] })
    } else {
      middle.push({ op: 'add', text: midB[j++] })
    }
  }
  while (i < midA.length) middle.push({ op: 'remove', text: midA[i++] })
  while (j < midB.length) middle.push({ op: 'add', text: midB[j++] })

  return [...head, ...middle, ...tail]
}

/** Counts for a diff's header: "+12 −3". */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.op === 'add') added++
    else if (line.op === 'remove') removed++
  }
  return { added, removed }
}
