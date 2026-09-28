import type { GitRefState, StatusCategory, TicketKind } from '@prisma/client'

/**
 * Development-artefact rules: how a branch, pull request or commit is tied to a
 * ticket, and what that is allowed to do to the ticket's status.
 *
 * Pure, so the domain suite can pin it down without GitHub or a database.
 */

// -----------------------------------------------------------------------------
// Finding ticket keys in git text
// -----------------------------------------------------------------------------

/**
 * A key as it appears in git text: `RC-14`, or `rc-14` in a branch name.
 *
 * Case-insensitive because branch names are conventionally lower case. That
 * makes the pattern alone far too permissive — `utf-8`, `sha-256` and
 * `iso-8601` all match it — which is why `extractTicketKeys` only accepts codes
 * belonging to projects the repository is linked to.
 */
const KEY_IN_TEXT = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})(?![0-9])/g

/**
 * Every distinct ticket key in `texts` whose project code is in `codes`,
 * upper-cased, in order of first appearance.
 */
export function extractTicketKeys(
  texts: ReadonlyArray<string | null | undefined>,
  codes: ReadonlySet<string>,
): string[] {
  const found = new Set<string>()

  for (const text of texts) {
    if (!text) continue
    for (const match of text.matchAll(KEY_IN_TEXT)) {
      const code = match[1].toUpperCase()
      if (!codes.has(code)) continue
      // `RC-014` and `RC-14` are the same ticket.
      found.add(`${code}-${Number(match[2])}`)
    }
  }

  return [...found]
}

// -----------------------------------------------------------------------------
// Branch names
// -----------------------------------------------------------------------------

/** Conventional-commit style prefix per kind, so a branch says what it is. */
const BRANCH_PREFIX: Record<TicketKind, string> = {
  TASK: 'chore',
  FEATURE: 'feat',
  ENHANCEMENT: 'feat',
  BUG: 'fix',
  PRODUCTION: 'hotfix',
  DEPLOYMENT: 'release',
  RESEARCH: 'spike',
}

/**
 * A branch name for a ticket: `fix/rc-14-tablet-loses-sync`.
 *
 * The key comes first after the prefix so it survives truncation, and the whole
 * name stays within what every git host displays without eliding.
 */
export function branchNameFor(key: string, title: string, kind: TicketKind): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const base = `${BRANCH_PREFIX[kind]}/${key.toLowerCase()}`
  if (!slug) return base
  if (slug.length <= 40) return `${base}-${slug}`

  // Cut at the last whole word that fits — "placehold" reads as a typo — and
  // only fall back to a hard cut when a single word is longer than the budget.
  const cut = slug.slice(0, 41)
  const boundary = cut.lastIndexOf('-')
  return `${base}-${boundary > 0 ? cut.slice(0, boundary) : slug.slice(0, 40)}`
}

// -----------------------------------------------------------------------------
// Status automation
// -----------------------------------------------------------------------------

/**
 * How far along the workflow each category is. BLOCKED sits with IN_PROGRESS:
 * a blocked ticket whose fix is merged is finished, not still blocked.
 */
const PROGRESS: Record<StatusCategory, number> = {
  BACKLOG: 0,
  TODO: 1,
  IN_PROGRESS: 2,
  BLOCKED: 2,
  REVIEW: 3,
  DONE: 4,
  CANCELLED: 4,
}

/**
 * Whether automation may move a ticket from `current` to `target`.
 *
 * Forward only. A pull request reopened on a ticket somebody already closed,
 * or a stray branch pushed against a finished one, must not drag it back — a
 * person made that call, and a webhook does not get to overrule it. Cancelled
 * tickets are never touched at all.
 */
export function mayAdvance(current: StatusCategory, target: StatusCategory): boolean {
  if (current === 'CANCELLED' || current === 'DONE') return false
  return PROGRESS[target] > PROGRESS[current]
}

export type GitEvent =
  | { kind: 'branch_created' }
  | { kind: 'pull_request'; state: GitRefState }

/**
 * The category a git event pushes a ticket towards, or null for none.
 *
 * A draft pull request counts as work in progress rather than review: it is
 * the author saying "not yet". Closing a pull request unmerged moves nothing,
 * because it says nothing about whether the ticket is done.
 */
export function targetCategoryFor(event: GitEvent): StatusCategory | null {
  if (event.kind === 'branch_created') return 'IN_PROGRESS'

  switch (event.state) {
    case 'DRAFT':
      return 'IN_PROGRESS'
    case 'OPEN':
      return 'REVIEW'
    case 'MERGED':
      return 'DONE'
    case 'CLOSED':
      return null
  }
}

// -----------------------------------------------------------------------------
// Ticket kinds
// -----------------------------------------------------------------------------

export const TICKET_KINDS: readonly TicketKind[] = [
  'TASK',
  'FEATURE',
  'ENHANCEMENT',
  'BUG',
  'PRODUCTION',
  'DEPLOYMENT',
  'RESEARCH',
]

export const TICKET_KIND_LABELS: Record<TicketKind, { label: string; hint: string }> = {
  TASK: { label: 'Task', hint: 'General work with no special handling.' },
  FEATURE: { label: 'Feature', hint: 'Something new.' },
  ENHANCEMENT: { label: 'Enhancement', hint: 'Making something that exists better.' },
  BUG: { label: 'Bug fix', hint: 'Something is wrong and needs correcting.' },
  PRODUCTION: { label: 'Production issue', hint: 'Broken in production, now.' },
  DEPLOYMENT: { label: 'Deployment', hint: 'Shipping a release to an environment.' },
  RESEARCH: { label: 'Research', hint: 'Finding out, not building.' },
}

/**
 * The kind a type's name implies. Mirrors the backfill in the migration that
 * introduced kinds, so a type created later is classified the same way as one
 * that already existed. Order matters: "Hotfix" must read as production before
 * the "fix" in it reads as a bug.
 */
export function inferTicketKind(name: string): TicketKind {
  const value = name.toLowerCase()
  if (/(deploy|release|rollout)/.test(value)) return 'DEPLOYMENT'
  if (/(hotfix|incident|production|outage|prod)/.test(value)) return 'PRODUCTION'
  if (/(bug|defect|fix)/.test(value)) return 'BUG'
  if (/(improve|enhance|refactor)/.test(value)) return 'ENHANCEMENT'
  if (/(story|feature|epic)/.test(value)) return 'FEATURE'
  if (/(research|spike|investigat)/.test(value)) return 'RESEARCH'
  return 'TASK'
}
