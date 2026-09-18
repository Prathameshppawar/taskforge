/* eslint-disable no-console */
/**
 * Domain verification suite.
 *
 * Covers the logic that is pure and therefore cheap to assert: the AI tool
 * trust boundary, progress rollup, the two-level hierarchy rule, ticket key
 * parsing, recurrence arithmetic and the RBAC matrix. No database, no network,
 * no model — it runs in under a second.
 *
 *     npm run verify
 */
import { getToolDefinitions, TOOL_SCHEMAS, isToolName } from '@/features/ai/tools'
import { clamp } from '@/features/ai/executor'
import { rollupProgress, assertValidParent, parseTicketKey, buildTicketKey } from '@/core/domain/ticket-rules'
import { previewSchedule, nextOccurrence, firstOccurrence } from '@/core/domain/recurrence'
import { canInProject, roleHas } from '@/core/domain/rbac'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n── AI tool contracts ──')
const defs = getToolDefinitions()
check('6 tools defined', defs.length === 6, `got ${defs.length}`)
check('no $schema leaks to the provider', defs.every((d) => !('$schema' in d.parameters)))
check('every tool has a description', defs.every((d) => d.description.trim().length > 0))

// The real constraint: Groq's free tier allows 8,000 tokens per minute and the
// tool payload is re-sent on every request. An arbitrary minimum description
// length is not the property worth protecting — the total budget is. Guard it,
// so a future edit cannot quietly cost the user conversations per minute.
const payloadTokens = Math.ceil(JSON.stringify(defs).length / 4)
check(
  `tool payload within budget (${payloadTokens} tokens, limit 1100)`,
  payloadTokens <= 1100,
  `${payloadTokens} tokens — trim tool descriptions`,
)
check('every tool exposes properties', defs.every((d) => 'properties' in d.parameters))
check('isToolName accepts known', isToolName('create_ticket'))
check('isToolName rejects unknown', !isToolName('drop_database'))

console.log('\n── Tool argument validation (the trust boundary) ──')
const good = TOOL_SCHEMAS.create_ticket.safeParse({ title: 'Login page returns 500' })
check('accepts a minimal valid call', good.success)

const short = TOOL_SCHEMAS.create_ticket.safeParse({ title: 'ab' })
check('rejects a too-short title', !short.success)

const empty = TOOL_SCHEMAS.create_ticket.safeParse({})
check('rejects a call with no title', !empty.success)

const injected = TOOL_SCHEMAS.create_ticket.safeParse({
  title: 'Valid title here',
  __proto__: { admin: true },
  extraneousField: 'ignored',
})
check('strips unknown fields', injected.success && !('extraneousField' in (injected.data as object)))

const badBulk = TOOL_SCHEMAS.bulk_create_tickets.safeParse({ parentTitle: 'Feature', children: [] })
check('rejects bulk create with no children', !badBulk.success)

const hugeBulk = TOOL_SCHEMAS.bulk_create_tickets.safeParse({
  parentTitle: 'Feature',
  children: Array.from({ length: 99 }, (_, i) => ({ title: `Task number ${i}` })),
})
check('caps bulk create at 30 children', !hugeBulk.success)

// Numeric bounds are deliberately ABSENT from the model-facing schema: Groq
// validates it server-side and rejects the whole request with a 400, so a
// model emitting `limit: 0` would break the turn outright. Out-of-range values
// are accepted and then clamped, which is what must be asserted.
const wideDays = TOOL_SCHEMAS.update_ticket.safeParse({ ticketKey: 'A-1', dueInDays: 99999 })
check('accepts an out-of-range due offset (clamped later)', wideDays.success)

check('clamp bounds a too-large value', clamp(99999, 0, 365, 7) === 365)
check('clamp bounds a negative value', clamp(-5, 0, 365, 7) === 0)
check('clamp falls back when undefined', clamp(undefined, 1, 50, 15) === 15)
check('clamp rejects NaN via fallback', clamp(Number.NaN, 1, 50, 15) === 15)
check('clamp truncates a float', clamp(12.9, 1, 50, 15) === 12)
check('clamp passes a valid value through', clamp(20, 1, 50, 15) === 20)

console.log('\n── Progress rollup ──')
const allDone = rollupProgress([{ statusCategory: 'DONE' }, { statusCategory: 'DONE' }])
check('all done → 100% and DONE', allDone.completionPercent === 100 && allDone.suggestedCategory === 'DONE')

const withCancelled = rollupProgress([
  { statusCategory: 'DONE' },
  { statusCategory: 'DONE' },
  { statusCategory: 'CANCELLED' },
])
check(
  'cancelled excluded from denominator → 100%',
  withCancelled.completionPercent === 100 && withCancelled.suggestedCategory === 'DONE',
  `got ${withCancelled.completionPercent}%`,
)

const blocked = rollupProgress([{ statusCategory: 'DONE' }, { statusCategory: 'BLOCKED' }])
check('any blocked child → parent BLOCKED', blocked.suggestedCategory === 'BLOCKED')

const started = rollupProgress([{ statusCategory: 'IN_PROGRESS' }, { statusCategory: 'TODO' }])
check('work started → IN_PROGRESS', started.suggestedCategory === 'IN_PROGRESS')

const untouched = rollupProgress([{ statusCategory: 'TODO' }, { statusCategory: 'BACKLOG' }])
check('nothing started → no suggestion', untouched.suggestedCategory === null)

const none = rollupProgress([])
check('no children → 0% and no suggestion', none.completionPercent === 0 && none.suggestedCategory === null)

const allCancelled = rollupProgress([{ statusCategory: 'CANCELLED' }])
check('all cancelled → 100%, no divide-by-zero', allCancelled.completionPercent === 100)

console.log('\n── Hierarchy depth rule ──')
function expectThrow(fn: () => void): boolean {
  try { fn(); return false } catch { return true }
}
check('ticket cannot be its own parent', expectThrow(() =>
  assertValidParent({ ticketId: 'a', parentId: 'a', hasChildren: false, parentIsChild: false, projectId: 'p' })))
check('cannot nest under a child (2-level cap)', expectThrow(() =>
  assertValidParent({ ticketId: 'a', parentId: 'b', hasChildren: false, parentIsChild: true, projectId: 'p' })))
check('a parent cannot become a child', expectThrow(() =>
  assertValidParent({ ticketId: 'a', parentId: 'b', hasChildren: true, parentIsChild: false, projectId: 'p' })))
check('cannot cross projects', expectThrow(() =>
  assertValidParent({ ticketId: 'a', parentId: 'b', hasChildren: false, parentIsChild: false, projectId: 'p', parentProjectId: 'q' })))
check('valid assignment passes', !expectThrow(() =>
  assertValidParent({ ticketId: 'a', parentId: 'b', hasChildren: false, parentIsChild: false, projectId: 'p', parentProjectId: 'p' })))
check('clearing the parent always allowed', !expectThrow(() =>
  assertValidParent({ ticketId: 'a', parentId: null, hasChildren: true, parentIsChild: false, projectId: 'p' })))

console.log('\n── Ticket keys ──')
check('builds a key', buildTicketKey('ATLAS', 14) === 'ATLAS-14')
check('parses a key', parseTicketKey('ATLAS-14')?.number === 14)
check('parses case-insensitively', parseTicketKey('atlas-14')?.code === 'ATLAS')
check('rejects a malformed key', parseTicketKey('not a key') === null)
check('rejects a key with no number', parseTicketKey('ATLAS-') === null)

console.log('\n── Recurrence ──')
const weekly = previewSchedule({
  frequency: 'WEEKLY', interval: 1, dayOfWeek: 1,
  startDate: new Date('2026-01-01T00:00:00Z'), endDate: null,
}, 4)
check('weekly yields 4 dates', weekly.length === 4)
check('weekly lands on Mondays', weekly.every((d) => d.getUTCDay() === 1),
  weekly.map((d) => d.toISOString().slice(0,10)).join(', '))
check('weekly dates strictly increase', weekly.every((d, i) => i === 0 || d > weekly[i-1]))

// The classic clamp bug: 31 Jan + 1 month must not roll into March.
const monthly = previewSchedule({
  frequency: 'MONTHLY', interval: 1, dayOfMonth: 31,
  startDate: new Date('2026-01-31T00:00:00Z'), endDate: null,
}, 3)
check('month-end clamps to shortest month (no March skip)',
  monthly[1].getUTCMonth() === 1,
  monthly.map((d) => d.toISOString().slice(0,10)).join(', '))

const bounded = previewSchedule({
  frequency: 'DAILY', interval: 1,
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-01-03T00:00:00Z'),
}, 10)
check('stops at the end date', bounded.length === 3, `got ${bounded.length}`)

const expired = nextOccurrence({
  frequency: 'DAILY', interval: 1,
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-01-02T00:00:00Z'),
}, new Date('2026-01-02T00:00:00Z'))
check('returns null once past the end date', expired === null)

console.log('\n── RBAC ──')
check('admin has every permission', roleHas('ADMIN', 'user:create') && roleHas('ADMIN', 'project:delete'))
check('plain user cannot create users', !roleHas('USER', 'user:create'))
check('plain user cannot delete projects', !roleHas('USER', 'project:delete'))
check('PM can manage members', roleHas('PROJECT_MANAGER', 'project:manage-members'))
check('PM cannot manage platform users', !roleHas('PROJECT_MANAGER', 'user:create'))

check('admin bypasses project scope',
  canInProject({ role: 'ADMIN', memberRole: null, isOwner: false }, 'project:manage-config'))
check('non-member user gets nothing',
  !canInProject({ role: 'USER', memberRole: null, isOwner: false }, 'ticket:create'))
check('VIEWER cannot create tickets',
  !canInProject({ role: 'USER', memberRole: 'VIEWER', isOwner: false }, 'ticket:create'))
check('MEMBER can create tickets',
  canInProject({ role: 'USER', memberRole: 'MEMBER', isOwner: false }, 'ticket:create'))
check('MEMBER cannot manage project config',
  !canInProject({ role: 'PROJECT_MANAGER', memberRole: 'MEMBER', isOwner: false }, 'project:manage-config'))
check('project MANAGER can manage config',
  canInProject({ role: 'PROJECT_MANAGER', memberRole: 'MANAGER', isOwner: false }, 'project:manage-config'))
check('owner can manage config even without membership row',
  canInProject({ role: 'PROJECT_MANAGER', memberRole: null, isOwner: true }, 'project:manage-config'))

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
