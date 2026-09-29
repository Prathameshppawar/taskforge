/**
 * Reading email as tickets: where a message is going, whether its sender is
 * who they say, and which part of it is new.
 *
 * Pure — every rule that decides whether an email becomes a ticket, a comment
 * or nothing is pinned by the domain suite.
 */

export type Route =
  | { kind: 'ticket'; key: string }
  | { kind: 'project'; code: string }
  | { kind: 'mailbox' }
  | null

/** Local part and domain, lower-cased; Gmail ignores dots in the local part. */
function splitAddress(address: string, gmail: boolean): { local: string; tag: string | null; domain: string } | null {
  const match = /^\s*([^@\s]+)@([^@\s]+)\s*$/.exec(address.toLowerCase())
  if (!match) return null
  const [base, ...tags] = match[1].split('+')
  return { local: gmail ? base.replace(/\./g, '') : base, tag: tags.length ? tags.join('+') : null, domain: match[2] }
}

const KEY = /^([a-z][a-z0-9]{1,9})-(\d+)$/
const CODE = /^[a-z][a-z0-9]{1,9}$/

/**
 * Where a message is addressed, among its recipients: `mailbox+demo-12@` is a
 * ticket, `mailbox+demo@` a project, the bare mailbox is the mailbox itself.
 * A ticket key in the subject — `[DEMO-12]`, as TaskForge's own emails carry —
 * counts as a ticket too, so replying from a client that drops the plus
 * address still lands in the right place.
 */
export function routeMessage(recipients: string[], mailbox: string, subject: string): Route {
  const own = splitAddress(mailbox, /@(gmail|googlemail)\.com$/i.test(mailbox))
  if (!own) return null
  let route: Route = null
  for (const recipient of recipients) {
    const parsed = splitAddress(recipient, own.domain === 'gmail.com' || own.domain === 'googlemail.com')
    if (!parsed || parsed.local !== own.local || parsed.domain !== own.domain) continue
    if (parsed.tag && KEY.test(parsed.tag)) return { kind: 'ticket', key: parsed.tag.toUpperCase() }
    if (parsed.tag && CODE.test(parsed.tag)) route = { kind: 'project', code: parsed.tag.toUpperCase() }
    else if (!parsed.tag && !route) route = { kind: 'mailbox' }
  }
  const inSubject = /\[([A-Z][A-Z0-9]{1,9}-\d+)\]/i.exec(subject)
  if (inSubject && route !== null) return { kind: 'ticket', key: inSubject[1].toUpperCase() }
  return route
}

/** The address a project's tickets are emailed to. */
export function projectAddress(mailbox: string, code: string): string {
  const [local, domain] = mailbox.split('@')
  return `${local.split('+')[0]}+${code.toLowerCase()}@${domain}`
}

/** The address a reply about one ticket should go to. */
export function ticketAddress(mailbox: string, key: string): string {
  return projectAddress(mailbox, key)
}

/**
 * Whether the sender is who the From header says.
 *
 * Anyone can type any From address, so a message only acts for an account when
 * the receiving server vouches for it: DMARC passed, or DKIM or SPF passed for
 * the From domain itself. Gmail records its verdict in Authentication-Results.
 */
export function senderAuthenticated(authenticationResults: string[], from: string): { ok: boolean; reason: string } {
  const domain = from.toLowerCase().split('@')[1]
  if (!domain) return { ok: false, reason: 'no sender address' }
  const text = authenticationResults.join('; ').toLowerCase()
  if (!text) return { ok: false, reason: 'the receiving server recorded no authentication results' }

  const dmarc = /dmarc=(\w+)[^;]*header\.from=([^\s;]+)/.exec(text)
  if (dmarc && dmarc[1] === 'pass' && sameOrg(dmarc[2], domain)) return { ok: true, reason: 'DMARC passed' }

  for (const match of text.matchAll(/dkim=(\w+)[^;]*header\.(?:i|d)=@?([^\s;]+)/g)) {
    if (match[1] === 'pass' && sameOrg(match[2].replace(/^.*@/, ''), domain)) return { ok: true, reason: 'DKIM passed for the sender’s domain' }
  }
  const spf = /spf=(\w+)[^;]*smtp\.mailfrom=([^\s;]+)/.exec(text)
  if (spf && spf[1] === 'pass' && sameOrg(spf[2].replace(/^.*@/, ''), domain)) return { ok: true, reason: 'SPF passed for the sender’s domain' }

  return { ok: false, reason: dmarc ? `DMARC ${dmarc[1]}` : 'no passing DMARC, DKIM or SPF for the sender’s domain' }
}

/** mail.acme.com and acme.com are one organisation; acme.com and evil.com are not. */
function sameOrg(a: string, b: string): boolean {
  const x = a.replace(/\.$/, '')
  const y = b.replace(/\.$/, '')
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)
}

/**
 * Mail nobody should answer: out-of-office replies, bounces, mailing lists.
 * Answering them is how two robots email each other forever.
 */
export function isAutomated(headers: Record<string, string | undefined>, from: string): boolean {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), (value ?? '').toLowerCase()]))
  if (lower['auto-submitted'] && lower['auto-submitted'] !== 'no') return true
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(lower['precedence'] ?? '')) return true
  if (lower['x-autoreply'] || lower['x-autorespond'] || lower['list-id'] || lower['list-unsubscribe']) return true
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from)
}

/**
 * The new part of a reply: everything above the quoted history and the
 * signature. Conservative — when in doubt it keeps text, because a comment
 * with a little quoted history is better than a comment with the answer cut.
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const next = `${line} ${lines[index + 1] ?? ''}`
    if (/^\s*on\b.{3,200}\bwrote:\s*$/i.test(line) || /^\s*on\b.{3,200}\bwrote:\s*$/i.test(next.trim())) break
    if (/^-{2,}\s*original message\s*-{2,}/i.test(line.trim())) break
    if (/^_{5,}\s*$/.test(line.trim()) && /^from:/i.test(lines[index + 1] ?? '')) break
    if (/^from:\s.+/i.test(line) && /^(sent|date):\s/i.test(lines[index + 1] ?? '')) break
    if (line === '-- ' || line === '--') break
    if (/^sent from my (iphone|ipad|android|mobile)/i.test(line.trim())) break
    out.push(line)
  }
  // Trailing quote blocks with no attribution line.
  while (out.length && (/^\s*>/.test(out[out.length - 1]) || out[out.length - 1].trim() === '')) out.pop()
  return out.join('\n').trim()
}

/** A ticket title from a subject: reply and forward prefixes and ticket tags removed. */
export function subjectToTitle(subject: string, fallback: string): string {
  let title = subject
  for (let pass = 0; pass < 5; pass++) {
    const next = title.replace(/^\s*(re|fwd?|aw|wg|sv|tr)\s*(\[\d+\])?\s*:\s*/i, '').replace(/^\s*\[[A-Z][A-Z0-9]{1,9}-\d+\]\s*/i, '')
    if (next === title) break
    title = next
  }
  title = title.replace(/\s+/g, ' ').trim()
  if (title.length < 3) return fallback
  return title.length > 200 ? `${title.slice(0, 197)}…` : title
}
