import type { TicketKind } from '@prisma/client'

/**
 * What a new ticket of each kind starts with.
 *
 * A bug report without steps to reproduce costs a round trip; a deployment
 * without a rollback plan costs more. These are the defaults a project's types
 * get, written by kind so a renamed type keeps its template. Each project can
 * edit or clear them in Settings → Ticket types.
 */
export interface KindTemplate {
  description: string | null
  checklist: string[]
}

export const KIND_TEMPLATES: Record<TicketKind, KindTemplate> = {
  BUG: {
    description: [
      '## Steps to reproduce',
      '1. ',
      '',
      '## Expected',
      '',
      '## Actual',
      '',
      '## Environment',
      'Browser / device / version:',
    ].join('\n'),
    checklist: ['The steps above no longer reproduce the bug', 'A test covers the case that failed'],
  },
  PRODUCTION: {
    description: [
      '## Impact',
      'Who is affected, and how badly:',
      '',
      '## Since',
      '',
      '## What we know',
      '',
    ].join('\n'),
    checklist: ['Users are no longer affected', 'The cause is understood and written up', 'Monitoring would catch it next time'],
  },
  DEPLOYMENT: {
    description: ['## What ships', '', '## Rollback plan', '', '## Who to tell', ''].join('\n'),
    checklist: ['Migrations run on production first', 'Smoke-tested after release', 'Release notes sent'],
  },
  FEATURE: {
    description: ['## Why', 'Who needs this, and what it lets them do:', '', '## What', '', '## Out of scope', ''].join('\n'),
    checklist: [],
  },
  ENHANCEMENT: {
    description: ['## Today', '', '## Better', ''].join('\n'),
    checklist: [],
  },
  RESEARCH: {
    description: ['## Question', '', '## Timebox', '', '## Findings', ''].join('\n'),
    checklist: ['The question is answered, or shown unanswerable', 'Findings are written on this ticket'],
  },
  TASK: { description: null, checklist: [] },
}

/** Criteria text is one short line: trimmed, collapsed, capped. */
export function normaliseCriterion(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * A template's description, but only where it would not overwrite anything:
 * an empty draft takes it, a draft that is still some other type's untouched
 * template is swapped, and anything a person typed is kept.
 */
export function applyDescriptionTemplate(
  draft: string,
  next: string | null,
  knownTemplates: Array<string | null>,
): string {
  const current = draft.trim()
  const untouched = current === '' || knownTemplates.some((template) => template !== null && template.trim() === current)
  return untouched ? (next ?? '') : draft
}
