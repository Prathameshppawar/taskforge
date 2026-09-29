/**
 * The Microsoft Teams bot's rules: which tokens to believe, what a message
 * asks for, and how a draft ticket is shown. Pure, so the security checks —
 * the part that must never be loosened — are pinned by the domain suite.
 */

export const BOT_ISSUER = 'https://api.botframework.com'
export const CLOCK_SKEW_SECONDS = 300

export interface BotTokenClaims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  nbf?: unknown
  serviceUrl?: unknown
  serviceurl?: unknown
}

/**
 * The claim checks Microsoft requires of a token the Bot Connector sends: our
 * app id as audience, Bot Framework as issuer, within its validity (five
 * minutes' skew), and a serviceUrl matching the activity's — so a token for
 * one conversation cannot be replayed to post into another. The signature is
 * checked separately, against Bot Framework's published keys.
 */
export function checkBotClaims(
  claims: BotTokenClaims,
  expected: { appId: string; serviceUrl: string; nowSeconds: number },
): { ok: true } | { ok: false; reason: string } {
  if (claims.iss !== BOT_ISSUER) return { ok: false, reason: 'wrong issuer' }
  if (claims.aud !== expected.appId) return { ok: false, reason: 'token is for another bot' }
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < expected.nowSeconds) return { ok: false, reason: 'token expired' }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > expected.nowSeconds) return { ok: false, reason: 'token not yet valid' }
  const serviceUrl = claims.serviceUrl ?? claims.serviceurl
  if (typeof serviceUrl !== 'string' || normaliseServiceUrl(serviceUrl) !== normaliseServiceUrl(expected.serviceUrl)) {
    return { ok: false, reason: 'serviceUrl does not match the activity' }
  }
  return { ok: true }
}

export function normaliseServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Where replies may be posted. The serviceUrl comes from the activity, so it
 * is checked against Microsoft's own hosts before a bot token is ever sent to
 * it — otherwise a forged activity could collect one.
 */
export function isTrustedServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return /(^|\.)(botframework\.com|trafficmanager\.net|teams\.microsoft\.com|botframework\.azure\.us)$/i.test(parsed.hostname)
  } catch {
    return false
  }
}

/** Message text without the bot's @mention, which Teams sends inline. */
export function stripMentions(text: string): string {
  return text
    .replace(/<at>[^<]*<\/at>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export type BotCommand =
  | { kind: 'help' }
  | { kind: 'link'; code: string }
  | { kind: 'unlink' }
  | { kind: 'use'; code: string }
  | { kind: 'create' }
  | { kind: 'discard' }
  | { kind: 'show'; key: string }
  | { kind: 'mute' }
  | { kind: 'unmute' }
  | { kind: 'chat'; text: string }

/** What a message asks for. Anything that is not a command is conversation. */
export function parseCommand(text: string, value?: unknown): BotCommand {
  const action = typeof value === 'object' && value !== null ? (value as { taskforge?: unknown }).taskforge : undefined
  if (action === 'create') return { kind: 'create' }
  if (action === 'discard') return { kind: 'discard' }

  const clean = stripMentions(text)
  const lower = clean.toLowerCase()
  if (/^(help|\?|what can you do\??)$/.test(lower)) return { kind: 'help' }
  const link = /^link\s+([a-z][a-z0-9]{1,9})$/i.exec(clean)
  if (link) return { kind: 'link', code: link[1].toUpperCase() }
  if (/^unlink$/.test(lower)) return { kind: 'unlink' }
  const use = /^(use|project)\s+([a-z][a-z0-9]{1,9})$/i.exec(clean)
  if (use) return { kind: 'use', code: use[2].toUpperCase() }
  if (/^(create( it| the ticket)?|file it|ship it)$/.test(lower)) return { kind: 'create' }
  if (/^(discard|start over|cancel)$/.test(lower)) return { kind: 'discard' }
  if (/^mute$/.test(lower)) return { kind: 'mute' }
  if (/^unmute$/.test(lower)) return { kind: 'unmute' }
  const show = /^(?:show\s+)?([A-Z][A-Z0-9]{1,9}-\d+)$/i.exec(clean)
  if (show) return { kind: 'show', key: show[1].toUpperCase() }
  return { kind: 'chat', text: clean }
}

export interface TicketDraft {
  title?: string
  description?: string
  type?: string
  priority?: string
  criteria?: string[]
}

/**
 * Adaptive Cards render bold, italics and lists but not headings, so a
 * heading becomes a bold line instead of a row of hashes.
 */
export function cardMarkdown(text: string): string {
  return text.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, '**$1**')
}

/** A draft is ready to file once it has a real title and some substance. */
export function draftReady(draft: TicketDraft | null): boolean {
  return Boolean(draft?.title && draft.title.trim().length >= 5 && (draft.description?.trim() || draft.criteria?.length))
}

/**
 * The draft as an Adaptive Card: what would be filed, and Create / Discard.
 * Buttons send `{ taskforge: 'create' }`, which `parseCommand` reads, so
 * pressing one is the same as typing it.
 */
export function draftCard(draft: TicketDraft, context: { projectName: string | null; similar: Array<{ key: string; title: string }>; participants: string[] }) {
  const facts = [
    ...(draft.type ? [{ title: 'Type', value: draft.type }] : []),
    ...(draft.priority ? [{ title: 'Priority', value: draft.priority }] : []),
    ...(context.projectName ? [{ title: 'Project', value: context.projectName }] : []),
  ]
  const ready = draftReady(draft)
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        { type: 'TextBlock', text: 'Draft ticket', size: 'Small', weight: 'Bolder', color: 'Accent' },
        { type: 'TextBlock', text: draft.title || '(no title yet)', size: 'Medium', weight: 'Bolder', wrap: true },
        ...(facts.length ? [{ type: 'FactSet', facts }] : []),
        ...(draft.description ? [{ type: 'TextBlock', text: cardMarkdown(draft.description).slice(0, 1500), wrap: true }] : []),
        ...(draft.criteria?.length
          ? [
              { type: 'TextBlock', text: 'Done when', weight: 'Bolder', spacing: 'Medium' },
              ...draft.criteria.slice(0, 12).map((item) => ({ type: 'TextBlock', text: `☐ ${item}`, wrap: true, spacing: 'None' })),
            ]
          : []),
        ...(context.similar.length
          ? [
              {
                type: 'TextBlock',
                text: `Similar: ${context.similar.map((entry) => `${entry.key} ${entry.title}`).join(' · ')}`,
                wrap: true,
                isSubtle: true,
                size: 'Small',
                spacing: 'Medium',
              },
            ]
          : []),
        ...(context.participants.length > 1
          ? [{ type: 'TextBlock', text: `Shaped by ${context.participants.join(', ')}`, isSubtle: true, size: 'Small' }]
          : []),
      ],
      actions: [
        ...(ready ? [{ type: 'Action.Submit', title: 'Create ticket', style: 'positive', data: { taskforge: 'create' } }] : []),
        { type: 'Action.Submit', title: 'Discard', data: { taskforge: 'discard' } },
      ],
    },
  }
}

export const HELP_TEXT = [
  'I help turn a conversation into a ticket. Just describe what you need — I’ll ask what’s missing and keep a draft. When it looks right, press **Create ticket** (or type `create`).',
  '',
  '- `use DEMO` — file into project DEMO from this chat',
  '- `link DEMO` — in a channel: tie it to project DEMO; new tickets there are posted here',
  '- `unlink`, `mute`, `unmute` — for a linked channel',
  '- `DEMO-12` — show a ticket',
  '- `discard` — throw the draft away',
].join('\n')
