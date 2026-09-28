import type { TicketKind } from '@prisma/client'

/**
 * Release-note arithmetic, pure so the domain suite pins it.
 *
 * Grouping happens here, by ticket kind, rather than being left to a model:
 * which section a change belongs in is a fact about the ticket, and a model
 * asked to sort thirty lines will occasionally put a bug fix under Features.
 */

export const RELEASE_SECTIONS: ReadonlyArray<{ title: string; kinds: readonly TicketKind[] }> = [
  { title: 'New', kinds: ['FEATURE'] },
  { title: 'Improved', kinds: ['ENHANCEMENT'] },
  { title: 'Fixed', kinds: ['BUG'] },
  { title: 'Production fixes', kinds: ['PRODUCTION'] },
  { title: 'Other changes', kinds: ['TASK', 'RESEARCH'] },
]

export interface ReleaseItem {
  key: string
  kind: TicketKind
  line: string
}

export function renderReleaseNotes(headline: string, items: ReleaseItem[]): string {
  const parts = [headline.trim()]
  for (const section of RELEASE_SECTIONS) {
    const rows = items.filter((item) => section.kinds.includes(item.kind))
    if (rows.length === 0) continue
    parts.push('', `### ${section.title}`, ...rows.map((item) => `- ${item.line.trim()} (${item.key})`))
  }
  return parts.join('\n')
}

/**
 * A date-based tag, `v2026.09.30`, suffixed `.2`, `.3` when a day ships more
 * than once. Calendar versioning because these are deployments of a service,
 * not a library with a compatibility promise to encode.
 */
export function nextReleaseTag(existing: ReadonlySet<string>, date: Date): string {
  const base = `v${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCDate()).padStart(2, '0')}`
  if (!existing.has(base)) return base
  for (let n = 2; n < 100; n++) if (!existing.has(`${base}.${n}`)) return `${base}.${n}`
  return `${base}.${Date.now()}`
}
