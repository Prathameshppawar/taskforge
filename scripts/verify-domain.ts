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
import { getToolDefinitions, TOOL_SCHEMAS, isToolName, allowNulls, dropNulls } from '@/features/ai/tools'
import { clamp } from '@/features/ai/executor'
import { parseSlash, matchingCommands, SLASH_COMMANDS } from '@/features/ai/slash'
import { describeLink, validateLink } from '@/features/tickets/relations'
import { percentile, cycleDays, summarise } from '@/features/tickets/estimates'
import { majority, commonLabels } from '@/features/tickets/triage'
import { escapeForCsv, csvCell, toCsv, exportFilename } from '@/features/export/service'
import { factsToPrompt, isQuietPeriod } from '@/features/reports/service'
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

import {
  branchNameFor,
  extractTicketKeys,
  inferTicketKind,
  mayAdvance,
  targetCategoryFor,
} from '@/core/domain/git-refs'
import { rollupChecks, toCheckState } from '@/features/github/service'
import { buildManifest, isPublicUrl, resolveWebhookUrl } from '@/features/github/manifest'
import { createAppJwt, verifyWebhookSignature } from '@/infrastructure/github/client'
import { seal, unseal } from '@/infrastructure/github/secrets'
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto'

import { applyEdit, checkRepoPath, uniqueBranch } from '@/core/domain/ai-fix'
import { codingToolDefinitions, resolveToolName } from '@/features/ai-fix/agent'
import { echoable } from '@/infrastructure/ai/anthropic'

import { costMicros, lastWeekRange, monthKey, monthStart, thresholdToAlert } from '@/core/domain/ai-budget'

import { checkWorkflow, isWorkflowPath } from '@/core/domain/ci-workflow'

import { isProductionEnvironment } from '@/features/github/deployments'

import { annotatePatch, partitionComments } from '@/core/domain/diff'

import { nextReleaseTag, renderReleaseNotes } from '@/core/domain/releases'

import { fingerprintOf, maskMessage, normalizeErrorPayload } from '@/core/domain/error-events'

import { checkMonitorUrl, describeDuration, isPrivateAddress, uptimePercent } from '@/core/domain/network'

import { changeFailureRate, failureRateBand, formatSpan, frequencyBand, leadTimeBand, median, recoveryBand } from '@/core/domain/dora'

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

console.log('\n── Estimates from history ──')
check('a single value is its own median', percentile([5], 0.5) === 5)
check('the median of an odd list is the middle', percentile([1, 3, 9], 0.5) === 3)
// Nearest-rank, not interpolated: with samples this small a real observed
// duration is more honest than the average of two that never happened.
check('an even list reports an observed value', [3, 5].includes(percentile([1, 3, 5, 9], 0.5)))
check('the extremes are reachable',
  percentile([2, 4, 6], 0) === 2 && percentile([2, 4, 6], 1) === 6)
check('an empty list does not throw', percentile([], 0.5) === 0)

const created = new Date('2026-01-01T00:00:00Z')
check('a normal duration is counted',
  cycleDays(created, new Date('2026-01-08T00:00:00Z')) === 7)
// The bug this guards: demo data once held tickets completed before they were
// created, and counting that as negative would drag a median below zero.
check('completion before creation is discarded',
  cycleDays(created, new Date('2025-12-25T00:00:00Z')) === null)
check('an unfinished ticket has no duration', cycleDays(created, null) === null)
check('same-day work counts as a day',
  cycleDays(created, new Date('2026-01-01T04:00:00Z')) === 1)
check('an implausible duration is discarded',
  cycleDays(created, new Date('2030-01-01T00:00:00Z')) === null)

const sample = (days: number) => ({ key: 'X-1', title: 't', days })
check('too few samples report nothing',
  summarise([sample(2), sample(4)]) === null)
const est = summarise([sample(9), sample(2), sample(5), sample(4)])
check('a summary reports the real spread',
  est !== null && est.fastestDays === 2 && est.slowestDays === 9)
check('the summary keeps its evidence',
  est !== null && est.comparable.length === 3)

console.log('\n── Triage from history ──')
check('a clear majority is offered',
  majority(['BUG', 'BUG', 'BUG', 'TASK'])?.value === 'BUG')
// A tie is a coin toss dressed as a decision, so it offers nothing.
check('a tie offers nothing', majority(['BUG', 'TASK']) === null)
// Half agreeing is enough for a suggestion the user reviews; a third is not.
check('half agreeing is enough',
  majority(['BUG', 'TASK', 'STORY', 'BUG'])?.value === 'BUG')
check('a weak plurality offers nothing',
  majority(['BUG', 'TASK', 'STORY', 'DOC', 'BUG', 'EPIC']) === null)
check('nulls are ignored, not counted',
  majority([null, 'BUG', 'BUG', undefined])?.count === 2)
check('an empty list offers nothing', majority([]) === null)
check('the evidence is reported',
  majority(['BUG', 'BUG', 'TASK'])?.outOf === 3)

check('a label on most tickets is offered',
  commonLabels([['a'], ['a'], ['a', 'b']]).some((l) => l.value === 'a'))
check('a rare label is not offered',
  !commonLabels([['a'], ['a'], ['a', 'b']]).some((l) => l.value === 'b'))
// A ticket carrying the same label twice must not count as two tickets.
check('a repeated label counts once per ticket',
  commonLabels([['a', 'a'], ['b'], ['b']]).every((l) => l.count <= 3))
check('no tickets means no labels', commonLabels([]).length === 0)

console.log('\n── Export ──')
// A spreadsheet is a program and every cell here was typed by a user. That is
// the whole reason the export has a service layer rather than a template.
check('a formula is neutralised', escapeForCsv('=1+1').startsWith("'"))
check('the classic injection payload is neutralised',
  escapeForCsv(String.raw`=cmd|'/c calc'!A0`).startsWith("'"))
check('a plus is a trigger', escapeForCsv('+1').startsWith("'"))
check('a minus is a trigger', escapeForCsv('-1').startsWith("'"))
check('an at sign is a trigger', escapeForCsv('@SUM(A1)').startsWith("'"))
// Excel strips leading whitespace before deciding, so a tab still reaches a
// formula — which is why the obvious "trim, then check" version is wrong.
check('a leading tab is a trigger', escapeForCsv('\t=1+1').startsWith("'"))
check('ordinary text is untouched', escapeForCsv('Fix the login bug') === 'Fix the login bug')
check('an empty value is untouched', escapeForCsv('') === '')
// A hyphen mid-string is arithmetic to nobody.
check('a hyphen inside a title is untouched',
  escapeForCsv('Re-open the sync issue') === 'Re-open the sync issue')

check('a comma forces quoting', csvCell('a,b') === '"a,b"')
check('a quote is doubled', csvCell('say "hi"').includes('""hi""'))
check('a newline forces quoting', csvCell('a\nb').startsWith('"'))
check('a date becomes ISO', csvCell(new Date('2026-03-04T10:00:00Z')) === '2026-03-04')
check('null becomes empty', csvCell(null) === '')

const csvSample = toCsv([{ a: 'x' }], [{ key: 'a', header: 'A', value: (r) => r.a }])
// Without the BOM Excel reads the system code page and mangles every accent.
check('the CSV starts with a BOM', csvSample.charCodeAt(0) === 0xfeff)
check('the CSV uses CRLF', csvSample.includes('\r\n'))
check('the header is written', csvSample.includes('A'))

check('the filename is dated and safe',
  exportFilename('Regency Ceramics!!', 'xlsx', new Date('2026-03-04T00:00:00Z')) ===
    'regency-ceramics-2026-03-04.xlsx')
check('an empty name still produces a file',
  exportFilename('', 'csv', new Date('2026-03-04T00:00:00Z')) === 'export-2026-03-04.csv')

console.log('\n── Status report ──')
const emptyFacts = {
  projectName: 'P', projectCode: 'P', periodDays: 7,
  completed: [], started: [], created: [], overdue: [], blocked: [], stalled: [],
  totals: { open: 0, done: 0, total: 0 },
}
// A quiet week costs no tokens: the model is never called for it.
check('a quiet period is detected', isQuietPeriod(emptyFacts))
check('any activity ends the quiet period',
  !isQuietPeriod({ ...emptyFacts, blocked: [{ key: 'A-1', title: 't', statusName: 'Blocked', assignee: null }] }))

const prompt = factsToPrompt({
  ...emptyFacts,
  completed: [{ key: 'RC-1', title: 'Fix sync', statusName: 'Done', assignee: 'Prakhar' }],
  stalled: [{ key: 'RC-9', title: 'Old work', statusName: 'In Progress', assignee: null, days: 14 }],
})
check('the prompt names the completed ticket', prompt.includes('RC-1'))
check('the prompt carries the assignee', prompt.includes('Prakhar'))
check('the prompt reports how long something stalled', prompt.includes('14d'))
// Empty sections are stated rather than omitted, so the model is not left to
// guess whether "no overdue tickets" means none or means unknown.
check('empty sections say none explicitly', prompt.includes('Overdue now: none'))
check('a ticket with no assignee does not print an empty bracket',
  !prompt.includes('()'))

console.log('\n── Model output tolerance ──')
// A model asked for an optional field it has no value for sends `null` far more
// often than it omits the key. Groq validates the tool call against our schema
// server-side, so one stray null loses the whole turn with an error the user
// can do nothing about. Both halves of the fix are asserted here.
const widened = allowNulls({
  type: 'object',
  required: ['ticketKey'],
  properties: {
    ticketKey: { type: 'string' },
    assignee: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' } },
    overdueOnly: { type: 'boolean' },
    statusCategory: { type: 'string', enum: ['BACKLOG', 'DONE'] },
  },
}) as { properties: Record<string, { type: unknown; enum?: unknown[] }> }

check('an optional string also accepts null',
  JSON.stringify(widened.properties.assignee.type) === '["string","null"]')
check('an optional array also accepts null',
  JSON.stringify(widened.properties.labels.type) === '["array","null"]')
check('a required field is left strict',
  widened.properties.ticketKey.type === 'string')
// The subtle half: an enum constrains the value as well as the type, so null
// passes `type` and then fails `enum` unless it is listed there too.
check('an optional enum also accepts null',
  widened.properties.statusCategory.enum?.includes(null) === true)
check('the enum keeps its real values',
  widened.properties.statusCategory.enum?.includes('DONE') === true)

check('nulls are dropped so optional means absent',
  !('assignee' in dropNulls({ title: 'x', assignee: null })))
check('real values survive', dropNulls({ title: 'x', assignee: null }).title === 'x')
check('false is not treated as absent', dropNulls({ overdueOnly: false }).overdueOnly === false)
check('zero is not treated as absent', dropNulls({ dueInDays: 0 }).dueInDays === 0)
check('an empty string is not treated as absent', dropNulls({ title: '' }).title === '')
// bulk_create_tickets sends children as objects carrying their own nulls.
const nested = dropNulls({ children: [{ title: 'a', assignee: null }] }) as {
  children: Array<Record<string, unknown>>
}
check('nulls inside array members are dropped too',
  !('assignee' in nested.children[0]) && nested.children[0].title === 'a')


console.log('\n── GitHub: ticket keys in git text ──')
const codes = new Set(['RC', 'AUTH'])
check('finds a key in a PR title', extractTicketKeys(['RC-14: fix sync'], codes).join() === 'RC-14')
check('finds a lower-case key in a branch name',
  extractTicketKeys(['fix/rc-14-tablet-sync'], codes).join() === 'RC-14')
check('ignores codes of projects the repo is not linked to',
  extractTicketKeys(['OPS-3 and RC-2'], codes).join() === 'RC-2')
check('ignores look-alikes: utf-8, sha-256, iso-8601',
  extractTicketKeys(['utf-8 sha-256 iso-8601'], new Set(['UTF', 'SHA', 'ISO'])).length === 3,
  'the allow-list is what rejects them; with the codes allowed they match, proving the filter matters')
check('…and rejects them once the codes are not real projects',
  extractTicketKeys(['utf-8 sha-256 iso-8601'], codes).length === 0)
check('de-duplicates across texts and zero padding',
  extractTicketKeys(['RC-14', 'rc-014', 'Closes RC-14'], codes).join() === 'RC-14')
check('keeps several distinct keys in order',
  extractTicketKeys(['RC-2 then AUTH-9 then RC-1'], codes).join() === 'RC-2,AUTH-9,RC-1')
check('does not read a key out of the middle of a word',
  extractTicketKeys(['ARC-14 XRC-2'], codes).length === 0)
check('does not truncate a longer number', extractTicketKeys(['RC-145'], codes).join() === 'RC-145')
check('null and empty texts are skipped', extractTicketKeys([null, undefined, ''], codes).length === 0)

console.log('\n── GitHub: branch names ──')
check('bug fix gets fix/', branchNameFor('RC-14', 'Tablet loses sync', 'BUG') === 'fix/rc-14-tablet-loses-sync')
check('production issue gets hotfix/', branchNameFor('RC-3', 'Checkout 500s', 'PRODUCTION') === 'hotfix/rc-3-checkout-500s')
check('deployment gets release/', branchNameFor('RC-9', 'v2.1', 'DEPLOYMENT') === 'release/rc-9-v2-1')
check('punctuation and accents collapse to hyphens',
  branchNameFor('RC-1', 'Café — “menu” / nav!!', 'FEATURE') === 'feat/rc-1-cafe-menu-nav')
check('a long title is cut without a trailing hyphen', (() => {
  const name = branchNameFor('RC-1', 'a'.repeat(39) + ' bcdef', 'TASK')
  return !name.endsWith('-') && name.length <= 'chore/rc-1-'.length + 40
})())
check('a long title is cut at a word, not mid-word',
  branchNameFor('DEMO-2', 'Contact email link points to a placeholder address', 'BUG') ===
    'fix/demo-2-contact-email-link-points-to-a')
check('a single over-long word is hard-cut', branchNameFor('RC-1', 'x'.repeat(60), 'TASK') === 'chore/rc-1-' + 'x'.repeat(40))
check('an all-symbol title leaves just the key', branchNameFor('RC-1', '!!!', 'TASK') === 'chore/rc-1')
check('the branch name round-trips to its ticket',
  extractTicketKeys([branchNameFor('AUTH-77', 'Login', 'BUG')], codes).join() === 'AUTH-77')

console.log('\n── GitHub: status automation ──')
check('opening a PR moves Todo to Review', mayAdvance('TODO', targetCategoryFor({ kind: 'pull_request', state: 'OPEN' })!))
check('a draft PR only reaches In Progress', targetCategoryFor({ kind: 'pull_request', state: 'DRAFT' }) === 'IN_PROGRESS')
check('merging moves Review to Done', mayAdvance('REVIEW', targetCategoryFor({ kind: 'pull_request', state: 'MERGED' })!))
check('closing unmerged moves nothing', targetCategoryFor({ kind: 'pull_request', state: 'CLOSED' }) === null)
check('a new branch moves Backlog to In Progress', mayAdvance('BACKLOG', targetCategoryFor({ kind: 'branch_created' })!))
check('a merged fix finishes a blocked ticket', mayAdvance('BLOCKED', 'DONE'))
check('never backwards: Review stays when a draft appears', !mayAdvance('REVIEW', 'IN_PROGRESS'))
check('never re-applies the same category', !mayAdvance('REVIEW', 'REVIEW'))
check('never reopens Done', !mayAdvance('DONE', 'REVIEW'))
check('never touches Cancelled', !mayAdvance('CANCELLED', 'DONE'))

console.log('\n── GitHub: CI rollup ──')
check('success, neutral and skipped pass', ['success', 'neutral', 'skipped'].every((c) => toCheckState('completed', c) === 'SUCCESS'))
check('failure, timed_out and cancelled fail', ['failure', 'timed_out', 'cancelled'].every((c) => toCheckState('completed', c) === 'FAILURE'))
check('anything not completed is pending', toCheckState('in_progress', null) === 'PENDING')
check('one failure fails the lot', rollupChecks([
  { status: 'completed', conclusion: 'success' },
  { status: 'completed', conclusion: 'failure' },
]) === 'FAILURE')
check('one running suite keeps it pending', rollupChecks([
  { status: 'completed', conclusion: 'success' },
  { status: 'queued', conclusion: null },
]) === 'PENDING')
check('no suites is no CI, not a pass', rollupChecks([]) === null)

console.log('\n── GitHub: ticket kinds ──')
check('Hotfix reads as production before its "fix" reads as a bug', inferTicketKind('Hotfix') === 'PRODUCTION')
check('Bug and Defect are bug fixes', inferTicketKind('Bug') === 'BUG' && inferTicketKind('Defect') === 'BUG')
check('Release is a deployment', inferTicketKind('Release') === 'DEPLOYMENT')
check('Improvement is an enhancement', inferTicketKind('Improvement') === 'ENHANCEMENT')
check('Story is a feature', inferTicketKind('Story') === 'FEATURE')
check('anything else is a task', inferTicketKind('Chore') === 'TASK')

console.log('\n── GitHub: app manifest ──')
check('localhost is not a webhook target', !isPublicUrl('http://localhost:3000/api/github/webhook'))
check('plain http is not a webhook target', !isPublicUrl('http://example.com/x'))
check('a public https URL is', isPublicUrl('https://taskforge.example.com/api/github/webhook'))
delete process.env.GITHUB_WEBHOOK_URL
check('local origin registers no webhook', resolveWebhookUrl('http://localhost:3000') === null)
check('a deployed origin registers its own', resolveWebhookUrl('https://tf.example.com') === 'https://tf.example.com/api/github/webhook')
const manifest = buildManifest('http://localhost:3000', 'TaskForge test')
check('manifest writes only contents and pull requests',
  Object.entries(manifest.default_permissions)
    .filter(([, level]) => level === 'write')
    .map(([name]) => name).sort().join() === 'contents,pull_requests')
check('manifest never asks for workflows or administration',
  !('workflows' in manifest.default_permissions) && !('administration' in manifest.default_permissions))
check('manifest webhook is active even without a URL', manifest.hook_attributes.active === true)
check('manifest redirects back to this origin',
  manifest.redirect_url === 'http://localhost:3000/api/github/manifest/callback')

console.log('\n── GitHub: webhook signatures ──')
const hookSecret = 'shh-its-a-secret'
const body = JSON.stringify({ action: 'opened', number: 1 })
const goodSig = `sha256=${createHmac('sha256', hookSecret).update(body).digest('hex')}`
check('a correct signature verifies', verifyWebhookSignature(body, goodSig, hookSecret))
check('a changed body is refused', !verifyWebhookSignature(body + ' ', goodSig, hookSecret))
check('the wrong secret is refused', !verifyWebhookSignature(body, goodSig, 'other'))
check('a missing header is refused', !verifyWebhookSignature(body, null, hookSecret))
check('the legacy sha1 header is refused', !verifyWebhookSignature(body, 'sha1=abc', hookSecret))

console.log('\n── GitHub: app JWT ──')
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const now = Date.UTC(2026, 8, 29, 12, 0, 0)
const jwt = createAppJwt(12345, pem, now)
const [h, p, sig] = jwt.split('.')
const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
check('the JWT verifies with the app public key',
  createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url'))
check('issuer is the app id', claims.iss === '12345')
check('issued-at is backdated for clock drift', claims.iat === now / 1000 - 60)
check('it lives under GitHub\'s ten-minute ceiling', claims.exp - claims.iat <= 600)

console.log('\n── GitHub: sealed credentials ──')
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'verify-domain-auth-secret-0123456789'
const sealed = seal(pem)
check('sealing round-trips', unseal(sealed) === pem)
check('the sealed value does not contain the key', !sealed.includes('PRIVATE KEY'))
check('sealing twice gives different ciphertext', seal(pem) !== sealed)
check('a tampered ciphertext refuses to open', (() => {
  const parts = sealed.split('.')
  const last = parts[3]
  parts[3] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1)
  return expectThrow(() => unseal(parts.join('.')))
})())


console.log('\n── AI fix: what a model may touch ──')
const pathOk = (p: string) => checkRepoPath(p).ok
check('an ordinary file is allowed', pathOk('index.html') && pathOk('src/app/page.tsx'))
check('./ prefixes are normalised', (checkRepoPath('./src//a.ts') as { path: string }).path === 'src/a.ts')
check('.. cannot escape the repository', !pathOk('../secrets.txt') && !pathOk('src/../../x'))
check('absolute paths are refused', !pathOk('/etc/passwd'))
check('git internals are refused', !pathOk('.git/config'))
check('CI workflows are refused', !pathOk('.github/workflows/deploy.yml') && !pathOk('.GitHub/Workflows/ci.yml'))
check('other .github files are allowed', pathOk('.github/CODEOWNERS'))
check('.env and .env.local are refused', !pathOk('.env') && !pathOk('apps/web/.env.local'))
check('.env.example is allowed', pathOk('.env.example'))
check('an empty path is refused', !pathOk('   ') && !pathOk('./'))

console.log('\n── AI fix: exact edits ──')
const edited = applyEdit('a hello b', 'hello', 'bye')
check('a unique match is replaced', edited.ok && edited.content === 'a bye b')
check('a missing match is refused', !applyEdit('abc', 'zzz', 'y').ok)
check('an ambiguous match is refused', !applyEdit('x x', 'x', 'y').ok)
check('empty old text is refused', !applyEdit('abc', '', 'y').ok)
check('replacement text containing the old text is fine', (() => {
  const r = applyEdit('one', 'one', 'one two')
  return r.ok && r.content === 'one two'
})())

console.log('\n── AI fix: branches and tools ──')
check('a free branch name is used as is', uniqueBranch('fix/rc-1', new Set()) === 'fix/rc-1')
check('a taken branch gets a suffix', uniqueBranch('fix/rc-1', new Set(['fix/rc-1', 'fix/rc-1-2'])) === 'fix/rc-1-3')
const codingTools = codingToolDefinitions()
check('seven coding tools', codingTools.length === 7)
check('there is a finish tool', codingTools.some((tool) => tool.name === 'finish'))
check('no coding tool can commit, push or merge',
  !codingTools.some((tool) => /commit|push|merge|run|exec|shell/i.test(tool.name)))
check('a namespaced tool call resolves (gpt-oss: repo_browser.read_file)',
  resolveToolName('repo_browser.read_file') === 'read_file' && resolveToolName('functions.finish') === 'finish')
check('a namespace cannot smuggle in an unknown tool', resolveToolName('repo_browser.exec') === null)
check('no $schema leaks into coding tools', codingTools.every((tool) => !('$schema' in tool.parameters)))

console.log('\n── AI fix: echoing Anthropic fallbacks ──')
type AnyBlock = Parameters<typeof echoable>[0][number]
const blocks = (list: Array<Record<string, unknown>>) => list as unknown as AnyBlock[]
const plain = blocks([{ type: 'thinking' }, { type: 'text' }, { type: 'tool_use' }])
check('with no fallback, content is echoed unchanged', echoable(plain).length === 3)
const afterFallback = echoable(blocks([
  { type: 'thinking' }, { type: 'text', text: 'partial' }, { type: 'tool_use' },
  { type: 'fallback' }, { type: 'thinking' }, { type: 'tool_use' },
]))
check('pre-boundary thinking and tool_use are dropped',
  afterFallback.map((b) => b.type).join() === 'text,thinking,tool_use')


console.log('\n── AI budgets: money and thresholds ──')
check('cost is exact in micro-dollars', costMicros(1_000_000, 0, 5, 25) === BigInt(5_000_000))
check('a small Opus call', costMicros(12_000, 800, 5, 25) === BigInt(80_000))
check('an unpriced model costs nothing', costMicros(50_000, 5_000, 0, 0) === BigInt(0))
const sep = new Date(Date.UTC(2026, 8, 29, 12))
check('month starts on the 1st, UTC', monthStart(sep).toISOString() === '2026-09-01T00:00:00.000Z')
check('month key is zero-padded', monthKey(new Date(Date.UTC(2026, 0, 5))) === '2026-01')
const $ = (d: number) => BigInt(Math.round(d * 1_000_000))
check('under 80% alerts nothing', thresholdToAlert($(39), 50, null, sep) === null)
check('crossing 80% alerts 80', thresholdToAlert($(40), 50, null, sep) === 80)
check('80 is not repeated in the same month', thresholdToAlert($(45), 50, '2026-09:80', sep) === null)
check('100 still fires after 80', thresholdToAlert($(50), 50, '2026-09:80', sep) === 100)
check('jumping past 100 sends only 100', thresholdToAlert($(70), 50, null, sep) === 100)
check('a new month resets alerts', thresholdToAlert($(45), 50, '2026-08:100', sep) === 80)
check('a zero limit never alerts', thresholdToAlert($(5), 0, null, sep) === null)
const week = lastWeekRange(new Date(Date.UTC(2026, 8, 30, 9))) // a Wednesday
check('last week starts on a Monday', week.from.toISOString() === '2026-09-21T00:00:00.000Z')
check('last week ends where this one begins', week.to.toISOString() === '2026-09-28T00:00:00.000Z')
check('on a Monday, "last week" is the week just ended',
  lastWeekRange(new Date(Date.UTC(2026, 8, 28, 6))).from.toISOString() === '2026-09-21T00:00:00.000Z')


console.log('\n── AI workflows: what a model-written workflow may do ──')
const GOOD = `name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes html-validate index.html
      - uses: some-org/some-action@0123456789abcdef0123456789abcdef01234567
      - run: gh pr comment --body ok
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
const goodWorkflow = checkWorkflow(GOOD)
check('a sensible CI workflow passes', goodWorkflow.ok, goodWorkflow.problems.join(' | '))
const refused = (label: string, src: string) => {
  const result = checkWorkflow(src)
  check(label, !result.ok, 'it was accepted')
}
const wfJob = (steps: string) => `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
refused('pull_request_target is refused', 'on: pull_request_target\njobs:\n  a: { runs-on: ubuntu-latest, steps: [{ run: echo }] }')
refused('workflow_run is refused', 'on:\n  workflow_run:\n    workflows: [CI]\njobs:\n  a: { runs-on: ubuntu-latest, steps: [{ run: echo }] }')
refused('a named secret is refused', wfJob('      - run: deploy\n        env:\n          T: ${{ secrets.VERCEL_TOKEN }}'))
refused('bracket access to secrets is refused', wfJob("      - run: echo ${{ secrets['VERCEL_TOKEN'] }}"))
refused('dumping every secret is refused', wfJob('      - run: echo ${{ toJSON(secrets) }}'))
refused('a secret smuggled beside GITHUB_TOKEN is refused',
  wfJob('      - run: echo ${{ secrets.GITHUB_TOKEN }} ${{ secrets.NPM_TOKEN }}'))
refused('secrets: inherit is refused', 'on: push\njobs:\n  a:\n    uses: org/repo/.github/workflows/x.yml@0123456789abcdef0123456789abcdef01234567\n    secrets: inherit')
refused('write-all is refused', 'on: push\npermissions: write-all\njobs:\n  a: { runs-on: ubuntu-latest, steps: [{ run: echo }] }')
refused('a third-party action on a tag is refused', wfJob('      - uses: some-org/deploy-action@v2'))
refused('a third-party action on a branch is refused', wfJob('      - uses: some-org/deploy-action@main'))
refused('an unpinned docker image is refused', wfJob('      - uses: docker://alpine:latest'))
refused('invalid YAML is refused', 'on: [push\njobs: {')
refused('a workflow with no jobs is refused', 'on: push')
check('a comment mentioning secrets is not a secret',
  checkWorkflow(wfJob('      # uses secrets.GITHUB_TOKEN only\n      - run: echo hi')).ok)
check('GitHub-owned actions may use tags', checkWorkflow(wfJob('      - uses: github/codeql-action/init@v3')).ok)
check('a pinned docker image is fine',
  checkWorkflow(wfJob('      - uses: docker://alpine@sha256:' + 'a'.repeat(64))).ok)
check('workflow paths are recognised', isWorkflowPath('.github/workflows/ci.yml') && !isWorkflowPath('.github/workflows/sub/x.yml'))
check('workflows stay refused unless the project allows them', !checkRepoPath('.github/workflows/ci.yml').ok)
check('an allowing project may write one', checkRepoPath('.github/workflows/ci.yml', { allowWorkflows: true }).ok)
check('…but not a stray file in the workflows folder',
  !checkRepoPath('.github/workflows/notes.txt', { allowWorkflows: true }).ok)


console.log('\n── Deployments: which environment is production ──')
check('the provider flag wins', isProductionEnvironment({ environment: 'live', production_environment: true }))
check('a flag of false wins over the name', !isProductionEnvironment({ environment: 'Production', production_environment: false }))
check('Vercel\'s "Production" is production', isProductionEnvironment({ environment: 'Production' }))
check('"prod" is production', isProductionEnvironment({ environment: 'prod' }))
check('Vercel\'s "Preview" is not', !isProductionEnvironment({ environment: 'Preview' }))
check('"Production – taskforge" (Vercel per-project name) reads its original environment',
  isProductionEnvironment({ environment: 'Production – taskforge', original_environment: 'Production' }))
check('staging is not production', !isProductionEnvironment({ environment: 'staging' }))


console.log('\n── AI runs: planning cannot change anything ──')
const planTools = codingToolDefinitions('PLAN').map((tool) => tool.name)
check('a plan run is offered only read tools and finish',
  planTools.sort().join() === 'finish,list_files,read_file,search_code')
check('a fix run keeps every tool', codingToolDefinitions('FIX').length === 7)
check('a heal run keeps every tool', codingToolDefinitions('HEAL_CI').length === 7)


console.log('\n── AI review: which diff lines GitHub accepts comments on ──')
const patch = '@@ -3,4 +3,5 @@ header\n a\n-b\n+B\n+C\n d\n\\ No newline at end of file'
const annotated = annotatePatch(patch)
check('context and added lines are commentable', [3, 4, 5, 6].every((n) => annotated.commentable.has(n)))
check('the removed line has no new-side number', annotated.commentable.size === 4)
check('numbers are printed beside the lines', annotated.text.includes('   4 | +B') && annotated.text.includes('     | -b'))
const second = annotatePatch('@@ -1,2 +1,2 @@\n x\n@@ -40,2 +41,3 @@\n y\n+z')
check('a second hunk restarts numbering at its header', second.commentable.has(41) && second.commentable.has(42) && !second.commentable.has(3))
const parts = partitionComments(
  [{ path: 'a.ts', line: 4, body: 'ok' }, { path: 'a.ts', line: 99, body: 'off the diff' }, { path: 'b.ts', line: 1, body: 'unknown file' }],
  new Map([['a.ts', annotated.commentable]]),
)
check('a valid line stays inline', parts.inline.length === 1 && parts.inline[0].line === 4)
check('an invalid line or file is kept as a general note, not dropped', parts.general.length === 2)


console.log('\n── Releases: notes and tags ──')
const notes = renderReleaseNotes('A tidy release.', [
  { key: 'RC-2', kind: 'BUG', line: 'Sync no longer drops orders offline' },
  { key: 'RC-1', kind: 'FEATURE', line: 'Batch numbers on delivery notes' },
  { key: 'RC-3', kind: 'TASK', line: 'Dependencies updated' },
])
check('sections follow a fixed order, not input order', notes.indexOf('### New') < notes.indexOf('### Fixed') && notes.indexOf('### Fixed') < notes.indexOf('### Other changes'))
check('empty sections are left out', !notes.includes('### Improved'))
check('each line keeps its key', notes.includes('(RC-2)') && notes.includes('(RC-1)'))
const day = new Date(Date.UTC(2026, 8, 30))
check('a fresh day gets a plain calendar tag', nextReleaseTag(new Set(), day) === 'v2026.09.30')
check('a second release that day is suffixed', nextReleaseTag(new Set(['v2026.09.30']), day) === 'v2026.09.30.2')
check('suffixes keep counting', nextReleaseTag(new Set(['v2026.09.30', 'v2026.09.30.2']), day) === 'v2026.09.30.3')


console.log('\n── Production errors: reading payloads and grouping them ──')
const generic = normalizeErrorPayload({ message: 'User 1234 not found', stack: 'Error\n    at load (app/user.ts:40:3)\n    at main', level: 'error', environment: 'production' })
check('a plain JSON error is read', generic?.message === 'User 1234 not found' && generic.environment === 'production')
check('its top frame is the first "at" line', generic?.topFrame === 'load (app/user.ts:40:3)')
const sentry = normalizeErrorPayload({ action: 'created', data: { event: {
  title: 'TypeError: x is undefined', level: 'fatal', environment: 'prod', release: 'abc1234',
  exception: { values: [{ type: 'TypeError', value: 'x is undefined', stacktrace: { frames: [
    { filename: 'node_modules/lib.js', lineno: 1, in_app: false },
    { filename: 'src/cart.ts', lineno: 88, function: 'total', in_app: true },
    { filename: 'node_modules/deep.js', lineno: 9, in_app: false },
  ] } }] },
} } })
check('a Sentry event is read', sentry?.title === 'TypeError: x is undefined' && sentry.level === 'fatal')
check('the crash site is the last in-app frame', sentry?.topFrame === 'src/cart.ts:88 in total')
check('the release is kept for suspect lookup', sentry?.release === 'abc1234')
check('a payload with no message is refused', normalizeErrorPayload({ foo: 1 }) === null)
check('a non-object is refused', normalizeErrorPayload('boom') === null && normalizeErrorPayload([1]) === null)
check('volatile parts are masked',
  maskMessage('User 42 <a@b.co> id 3f2c1a9e-1b2c-4d5e-8f90-123456789abc said "hi"') === 'User <n> <<email>> id <uuid> said <str>')
const again = normalizeErrorPayload({ message: 'User 9999 not found', stack: 'Error\n    at load (app/user.ts:41:9)' })
check('the same bug with a different id and line groups together', fingerprintOf(generic!) === fingerprintOf(again!))
const other = normalizeErrorPayload({ message: 'User 1234 not found', stack: 'Error\n    at save (app/user.ts:40:3)' })
check('the same message from a different function is a different error', fingerprintOf(generic!) !== fingerprintOf(other!))
check('a sender fingerprint wins', fingerprintOf({ ...generic!, fingerprint: 'mine' }) === fingerprintOf({ ...other!, fingerprint: 'mine' }))


console.log('\n── Uptime: what the server may be asked to fetch ──')
check('public addresses are allowed', !isPrivateAddress('93.184.216.34') && !isPrivateAddress('2606:4700::1111'))
check('loopback is refused', isPrivateAddress('127.0.0.1') && isPrivateAddress('::1'))
check('cloud metadata is refused', isPrivateAddress('169.254.169.254'))
check('private ranges are refused', ['10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.1', '100.64.0.1'].every(isPrivateAddress))
check('172.32.x is public, not private', !isPrivateAddress('172.32.0.1'))
check('IPv6 private and link-local are refused', isPrivateAddress('fd00::1') && isPrivateAddress('fe80::1'))
check('IPv4-mapped IPv6 loopback is refused', isPrivateAddress('::ffff:127.0.0.1'))
check('an https URL to a public host is accepted', checkMonitorUrl('https://example.com/health').ok)
check('localhost is refused', !checkMonitorUrl('http://localhost:3000').ok)
check('a literal private IP is refused', !checkMonitorUrl('http://169.254.169.254/latest/meta-data').ok)
check('file: and other schemes are refused', !checkMonitorUrl('file:///etc/passwd').ok && !checkMonitorUrl('ftp://example.com').ok)
check('credentials in the URL are refused', !checkMonitorUrl('https://user:pw@example.com').ok)
check('uptime is a percentage to one place', uptimePercent([{ ok: true }, { ok: true }, { ok: false }]) === 66.7)
check('no checks means unknown, not 100%', uptimePercent([]) === null)
check('durations read naturally', describeDuration(4 * 60_000) === '4 minutes' && describeDuration(125 * 60_000) === '2 hours 5 minutes')


console.log('\n── Delivery: DORA metrics and bands ──')
check('median of an odd list', median([5, 1, 3]) === 3)
check('median of an even list averages the middle', median([1, 2, 3, 10]) === 2.5)
check('median of nothing is unknown, not zero', median([]) === null)
check('daily deploys are elite', frequencyBand(7) === 'elite' && frequencyBand(1) === 'high' && frequencyBand(0.3) === 'medium' && frequencyBand(0.1) === 'low')
check('lead time under a day is elite', leadTimeBand(3_600_000) === 'elite' && leadTimeBand(3 * 86_400_000) === 'high')
check('failure rate bands', failureRateBand(0.04) === 'elite' && failureRateBand(0.1) === 'high' && failureRateBand(0.5) === 'low')
check('recovery under an hour is elite', recoveryBand(30 * 60_000) === 'elite' && recoveryBand(2 * 86_400_000) === 'medium')
const d = (h: number) => new Date(Date.UTC(2026, 8, 1, h))
check('a deploy followed by an incident within a day failed',
  changeFailureRate([d(0), d(48)], [d(5)]) === 0.5)
check('an incident before a deploy does not blame it', changeFailureRate([d(10)], [d(5)]) === 0)
check('one deploy with two incidents counts once', changeFailureRate([d(0)], [d(1), d(2)]) === 1)
check('no deploys is unknown, not zero', changeFailureRate([], [d(1)]) === null)
check('spans read at DORA scale', formatSpan(45 * 60_000) === '45 min' && formatSpan(3 * 3_600_000) === '3 h' && formatSpan(4 * 86_400_000) === '4 days')

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
