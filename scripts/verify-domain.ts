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
import { parseSlash, matchingCommands, SLASH_COMMANDS } from '@/features/ai/slash'
import { describeLink, validateLink } from '@/features/tickets/relations'
import {
  contentDisposition,
  isInlineType,
  sanitiseFilename,
  storedContentType,
  validateUpload,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TICKET,
} from '@/features/attachments/service'
import { rollupProgress, assertValidParent, parseTicketKey, buildTicketKey } from '@/core/domain/ticket-rules'
import { previewSchedule, nextOccurrence, firstOccurrence } from '@/core/domain/recurrence'
import {
  canInProject,
  hasPermission,
  isPermission,
  outranks,
  strongestProjectRole,
  PERMISSIONS,
  PERMISSION_GROUPS,
  SYSTEM_ROLES,
  type Permission,
} from '@/core/domain/rbac'

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
check('8 tools defined', defs.length === 8, `got ${defs.length}`)
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

console.log('\n── RBAC: the permission catalogue ──')
const admin = SYSTEM_ROLES.find((r) => r.key === 'ADMIN')!
const pm = SYSTEM_ROLES.find((r) => r.key === 'PROJECT_MANAGER')!
const user = SYSTEM_ROLES.find((r) => r.key === 'USER')!

check('admin holds every permission', admin.permissions.length === PERMISSIONS.length)
check('plain user cannot create users', !hasPermission(user.permissions, 'user:create'))
check('plain user cannot delete projects', !hasPermission(user.permissions, 'project:delete'))
check('PM can manage project members', hasPermission(pm.permissions, 'project:manage-members'))
check('PM cannot manage platform users', !hasPermission(pm.permissions, 'user:create'))
check('PM cannot manage roles', !hasPermission(pm.permissions, 'role:manage'))

// A permission the editor never shows cannot be granted deliberately, which
// makes it a capability nobody can audit.
const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)))
const ungrouped = PERMISSIONS.filter((p) => !grouped.has(p))
check(
  'every permission appears in the role editor',
  ungrouped.length === 0,
  ungrouped.join(', '),
)
check('the editor invents no permissions', [...grouped].every((p) => isPermission(p)))
check('no permission is listed in two groups', grouped.size === PERMISSIONS.length)

console.log('\n── RBAC: seniority ──')
check('a senior rank outranks a junior one', outranks(admin.level, user.level))
check('a junior rank does not outrank a senior one', !outranks(user.level, admin.level))
// The one that matters: equal ranks must not be able to act on each other, or
// two admins can demote one another and a workspace can end up with none.
check('a peer does not outrank a peer', !outranks(admin.level, admin.level))
check('system levels are ordered admin < PM < user', admin.level < pm.level && pm.level < user.level)
check('levels leave room for custom roles between them', pm.level - admin.level > 1)

console.log('\n── RBAC: project scope ──')
const ALL: Permission[] = [...PERMISSIONS]

check('project:access-all waives membership',
  canInProject({ permissions: ALL, memberRole: null, isOwner: false }, 'project:manage-config'))
check('non-member gets nothing',
  !canInProject({ permissions: [...user.permissions], memberRole: null, isOwner: false }, 'ticket:create'))
check('VIEWER cannot create tickets',
  !canInProject({ permissions: [...user.permissions], memberRole: 'VIEWER', isOwner: false }, 'ticket:create'))
check('MEMBER can create tickets',
  canInProject({ permissions: [...user.permissions], memberRole: 'MEMBER', isOwner: false }, 'ticket:create'))
check('MEMBER cannot manage project config',
  !canInProject({ permissions: [...pm.permissions], memberRole: 'MEMBER', isOwner: false }, 'project:manage-config'))
check('project MANAGER can manage config',
  canInProject({ permissions: [...pm.permissions], memberRole: 'MANAGER', isOwner: false }, 'project:manage-config'))
check('owner can manage config without a membership row',
  canInProject({ permissions: [...pm.permissions], memberRole: null, isOwner: true }, 'project:manage-config'))

// view-all is visibility; access-all is capability. Conflating them would let
// every Project Manager reconfigure a project they are not part of.
check('seeing every project does not grant acting in every project',
  !canInProject(
    { permissions: [...pm.permissions], memberRole: null, isOwner: false },
    'project:manage-config',
  ))
check('PM can see every project', hasPermission(pm.permissions, 'project:view-all'))
check('PM cannot act in every project', !hasPermission(pm.permissions, 'project:access-all'))

// access-all waives scope; it must never add a capability the role lacks.
check('access-all does not invent capabilities',
  !canInProject(
    { permissions: ['project:access-all', 'project:view'], memberRole: null, isOwner: false },
    'project:delete',
  ))

console.log('\n── RBAC: access from teams ──')
// Access can arrive directly and through any number of attached teams, so the
// routes must be reconciled the same way every time.
check('no routes means no access', strongestProjectRole([]) === null)
check('a single route is used as-is', strongestProjectRole(['VIEWER']) === 'VIEWER')
check('the strongest route wins', strongestProjectRole(['VIEWER', 'MANAGER']) === 'MANAGER')
check('order does not matter', strongestProjectRole(['MANAGER', 'VIEWER']) === 'MANAGER')
// The rule that matters: joining a second, weaker team must never take away
// access somebody already had.
check(
  'a weaker team cannot downgrade existing access',
  strongestProjectRole(['MANAGER', 'VIEWER', 'MEMBER']) === 'MANAGER',
)
check('member beats viewer', strongestProjectRole(['VIEWER', 'MEMBER']) === 'MEMBER')

console.log('\n── Slash commands ──')
// These exist to skip the model, so the parse has to be exactly right: a
// command that silently mis-parses would act on the wrong ticket.
check('every command maps to a real tool', SLASH_COMMANDS.every((c) => {
  const built = c.build(c.requiresArgs ? 'RC-14 something' : '')
  return built === null || isToolName(built.tool)
}))

const find = parseSlash('/find login bug')
check('/find carries its text', find?.call?.arguments.query === 'login bug')

const mine = parseSlash('/mine')
check('/mine needs no argument', mine?.call?.arguments.assignee === 'me')

const assign = parseSlash('/assign rc-14 prakhar')
check('/assign upper-cases the key', assign?.call?.arguments.ticketKey === 'RC-14')
check('/assign keeps the rest as the person', assign?.call?.arguments.assignee === 'prakhar')

const comment = parseSlash('/comment RC-9 looks good to me')
check('/comment splits key from body', comment?.call?.arguments.body === 'looks good to me')

// The failure that matters: a missing argument must produce no call at all
// rather than a call with an empty field.
check('a command missing its argument builds nothing', parseSlash('/assign RC-14')?.call === null)
check('an unknown command is not a command', parseSlash('/nonsense') === null)
// Otherwise a sentence beginning with a slash would error instead of being answered.
check('a plain message is not a command', parseSlash('hello there') === null)

check('writes are marked as mutating', parseSlash('/move RC-1 Done')!.command.mutates)
check('reads are not', !parseSlash('/overdue')!.command.mutates)

check('the menu filters by prefix', matchingCommands('/mi').every((c) => c.name.startsWith('mi')))
check('the menu closes once arguments start', matchingCommands('/find abc').length === 0)

console.log('\n── Ticket links ──')
// A link is stored once. Everything about how it *reads* from the other end is
// derived, so the derivation is the thing worth asserting.
check('blocks reads as blocked-by from the other end',
  describeLink('BLOCKS', 'outgoing') === 'blocks' &&
  describeLink('BLOCKS', 'incoming') === 'is blocked by')
check('relates-to reads the same both ways',
  describeLink('RELATES_TO', 'outgoing') === describeLink('RELATES_TO', 'incoming'))

check('a ticket cannot link to itself', !validateLink('a', 'a', 'RELATES_TO', []).ok)
check('the same link cannot be added twice',
  !validateLink('a', 'b', 'BLOCKS', [{ sourceId: 'a', targetId: 'b', type: 'BLOCKS' }]).ok)
// Symmetric, so the mirrored row is the same link rather than a second one.
check('a mirrored relates-to is the same link',
  !validateLink('a', 'b', 'RELATES_TO', [{ sourceId: 'b', targetId: 'a', type: 'RELATES_TO' }]).ok)
// The one that matters: two tickets blocking each other can never both start.
check('two tickets cannot block each other',
  !validateLink('a', 'b', 'BLOCKS', [{ sourceId: 'b', targetId: 'a', type: 'BLOCKS' }]).ok)
check('blocking in one direction is fine',
  validateLink('a', 'b', 'BLOCKS', [{ sourceId: 'a', targetId: 'c', type: 'BLOCKS' }]).ok)
// Directional, so the reverse is a different link and must be allowed.
check('a duplicates b does not forbid b duplicates a',
  validateLink('a', 'b', 'DUPLICATES', [{ sourceId: 'b', targetId: 'a', type: 'DUPLICATES' }]).ok)

console.log('\n── Attachments ──')
check('images render inline', isInlineType('image/png') && isInlineType('image/jpeg'))
// The security decision: an SVG is a document that can carry script, so serving
// one inline from our origin would be a stored XSS with the session cookie.
check('SVG is never inline', !isInlineType('image/svg+xml'))
check('HTML is never inline', !isInlineType('text/html'))
check('parameters and casing do not smuggle a type past the check',
  isInlineType('IMAGE/PNG; charset=utf-8'))

check('an unknown type becomes a plain stream',
  storedContentType('totally/made-up; x=1') === 'totally/made-up')
check('a malformed type becomes a plain stream',
  storedContentType('not-a-type') === 'application/octet-stream')

// A filename reaches a header, so a quote or newline in it would let an upload
// inject header directives.
check('quotes are stripped from filenames', !sanitiseFilename('a"b.png').includes('"'))
check('newlines are stripped from filenames', !/[\r\n]/.test(sanitiseFilename('a\r\nb.png')))
check('an empty filename still yields something', sanitiseFilename('""') === 'download')
check('the disposition forces a download for SVG',
  contentDisposition('x.svg', 'image/svg+xml').startsWith('attachment'))
check('the disposition renders a PNG inline',
  contentDisposition('x.png', 'image/png').startsWith('inline'))

check('an empty file is refused', !validateUpload(0, 0).ok)
check('an oversized file is refused', !validateUpload(MAX_ATTACHMENT_BYTES + 1, 0).ok)
check('a file at the limit is allowed', validateUpload(MAX_ATTACHMENT_BYTES, 0).ok)
check('a full ticket refuses more', !validateUpload(10, MAX_ATTACHMENTS_PER_TICKET).ok)

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
