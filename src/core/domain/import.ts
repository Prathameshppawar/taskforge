import type { StatusCategory } from '@prisma/client'

/**
 * Reading other trackers' exports into one shape.
 *
 * Runs in the browser (the file never has to be stored on the server) and in
 * the domain suite. Three sources: Jira's CSV export, Trello's JSON export,
 * and any other CSV with a column mapping a person can adjust.
 */

export interface ImportItem {
  /** The key in the source system, e.g. "ABC-12" or a Trello card id. */
  ref: string
  title: string
  description?: string
  status?: string
  type?: string
  priority?: string
  assignee?: string
  reporter?: string
  labels: string[]
  dueDate?: string
  createdAt?: string
  resolvedAt?: string
  storyPoints?: number
  parentRef?: string
  criteria: Array<{ text: string; done: boolean }>
  comments: Array<{ author?: string; at?: string; body: string }>
}

export type ImportSource = 'jira' | 'trello' | 'csv'

// --- CSV ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF.
 * Returns rows of cells; the header is the first row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^﻿/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  row.push(cell)
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

export type CsvField =
  | 'ref'
  | 'title'
  | 'description'
  | 'status'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'labels'
  | 'dueDate'
  | 'createdAt'
  | 'resolvedAt'
  | 'storyPoints'
  | 'parentRef'
  | 'comment'
  | 'ignore'

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  ref: 'Original key',
  title: 'Title',
  description: 'Description',
  status: 'Status',
  type: 'Type',
  priority: 'Priority',
  assignee: 'Assignee',
  reporter: 'Reporter',
  labels: 'Labels',
  dueDate: 'Due date',
  createdAt: 'Created',
  resolvedAt: 'Resolved',
  storyPoints: 'Story points',
  parentRef: 'Parent key',
  comment: 'Comment',
  ignore: '— ignore —',
}

const GUESSES: Array<[RegExp, CsvField]> = [
  [/^(issue key|key|id|ticket id|card id)$/i, 'ref'],
  [/^(summary|title|name|subject|card name)$/i, 'title'],
  [/^(description|details|body|desc)$/i, 'description'],
  [/^(status|state|list|column)$/i, 'status'],
  [/^(issue type|type|kind)$/i, 'type'],
  [/^(priority|severity)$/i, 'priority'],
  [/^(assignee|assigned to|owner)$/i, 'assignee'],
  [/^(reporter|created by|author|requester)$/i, 'reporter'],
  [/^(labels?|tags?)$/i, 'labels'],
  [/^(due date|due|deadline)$/i, 'dueDate'],
  [/^(created|created at|date created)$/i, 'createdAt'],
  [/^(resolved|resolution date|done date|completed)$/i, 'resolvedAt'],
  [/story points|estimate|points/i, 'storyPoints'],
  [/^(parent|parent key|parent id|epic link|parent summary)$/i, 'parentRef'],
  [/^comments?$/i, 'comment'],
]

/** A first guess at what each column holds, from its header. */
export function guessMapping(header: string[]): CsvField[] {
  const used = new Set<CsvField>()
  return header.map((name) => {
    const cleaned = name.replace(/^custom field \((.*)\)$/i, '$1').trim()
    const guess = GUESSES.find(([pattern]) => pattern.test(cleaned))?.[1] ?? 'ignore'
    // Jira repeats Labels and Comment columns; everything else maps once.
    if (guess !== 'labels' && guess !== 'comment' && used.has(guess)) return 'ignore'
    used.add(guess)
    return guess
  })
}

/** Jira's export has "Issue key" and "Summary"; nothing else does both. */
export function detectSource(filename: string, text: string): ImportSource {
  if (/\.json$/i.test(filename) || text.trimStart().startsWith('{')) return 'trello'
  const header = parseCsv(text.split(/\r?\n/, 1)[0] ?? '')[0] ?? []
  return header.some((cell) => /^issue key$/i.test(cell.trim())) && header.some((cell) => /^summary$/i.test(cell.trim())) ? 'jira' : 'csv'
}

/** Items from a CSV and a mapping of its columns. Rows without a title are skipped. */
export function itemsFromCsv(rows: string[][], mapping: CsvField[], source: 'jira' | 'csv'): ImportItem[] {
  const [, ...body] = rows
  return body
    .map((row, index) => {
      const item: ImportItem = { ref: '', title: '', labels: [], criteria: [], comments: [] }
      mapping.forEach((field, column) => {
        const value = (row[column] ?? '').trim()
        if (!value || field === 'ignore') return
        switch (field) {
          case 'labels':
            item.labels.push(...value.split(/[,;]|\s{2,}/).map((label) => label.trim()).filter(Boolean))
            break
          case 'comment':
            item.comments.push(source === 'jira' ? jiraComment(value) : { body: value })
            break
          case 'storyPoints': {
            const points = Number(value)
            if (Number.isFinite(points) && points >= 0) item.storyPoints = Math.round(points)
            break
          }
          case 'dueDate':
          case 'createdAt':
          case 'resolvedAt': {
            const date = parseLooseDate(value)
            if (date) item[field] = date
            break
          }
          default:
            ;(item as unknown as Record<string, string>)[field] = value
        }
      })
      if (!item.ref) item.ref = `row-${index + 2}`
      item.labels = [...new Set(item.labels)]
      return item
    })
    .filter((item) => item.title.length > 0)
}

/** Jira exports a comment as "date;accountId;text". */
function jiraComment(value: string): ImportItem['comments'][number] {
  const match = /^([^;]{6,40});([^;]*);([\s\S]*)$/.exec(value)
  if (!match) return { body: value }
  return { at: parseLooseDate(match[1]) ?? undefined, author: match[2] || undefined, body: match[3].trim() }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Dates as exports write them: ISO, "2026-09-29 14:03", Jira's "29/Sep/26 2:03 PM",
 * "29 Sep 2026". Returned as an ISO string, or null when it cannot be read.
 */
export function parseLooseDate(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  const jira = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i.exec(text)
  if (jira) {
    const month = MONTHS.indexOf(jira[2].toLowerCase())
    if (month < 0) return null
    const year = Number(jira[3]) < 100 ? 2000 + Number(jira[3]) : Number(jira[3])
    let hour = Number(jira[4] ?? 0)
    if (jira[6]?.toUpperCase() === 'PM' && hour < 12) hour += 12
    if (jira[6]?.toUpperCase() === 'AM' && hour === 12) hour = 0
    return new Date(Date.UTC(year, month, Number(jira[1]), hour, Number(jira[5] ?? 0))).toISOString()
  }
  const iso = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(text)
  const zoned = /[zZ]$|[+-]\d{2}:?\d{2}$|\b(GMT|UTC)\b/.test(text)
  // Without a zone, a date means that date everywhere: read it as UTC, not as
  // wherever this happens to run.
  const parsed = Date.parse(
    iso && !zoned ? `${text.replace(' ', 'T')}${text.length > 10 ? 'Z' : 'T00:00:00Z'}` : zoned ? text : `${text} UTC`,
  )
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

// --- Trello ------------------------------------------------------------------------

interface TrelloBoard {
  lists?: Array<{ id: string; name: string; closed?: boolean }>
  cards?: Array<{
    id: string
    idShort?: number
    name: string
    desc?: string
    idList: string
    closed?: boolean
    due?: string | null
    dateLastActivity?: string
    labels?: Array<{ name?: string; color?: string }>
    idMembers?: string[]
    idChecklists?: string[]
  }>
  members?: Array<{ id: string; fullName?: string; username?: string }>
  checklists?: Array<{ id: string; idCard: string; checkItems?: Array<{ name: string; state: string; pos?: number }> }>
  actions?: Array<{ type: string; date?: string; data?: { card?: { id: string }; text?: string }; memberCreator?: { fullName?: string } }>
}

/**
 * Items from a Trello board export. The list a card sits in is its status,
 * checklists become acceptance criteria, and comments come along. Archived
 * cards are left behind.
 */
export function itemsFromTrello(json: string): ImportItem[] {
  const board = JSON.parse(json) as TrelloBoard
  const lists = new Map((board.lists ?? []).map((list) => [list.id, list.name]))
  const members = new Map((board.members ?? []).map((member) => [member.id, member.fullName || member.username || '']))
  const checklists = new Map<string, Array<{ text: string; done: boolean }>>()
  for (const checklist of board.checklists ?? []) {
    const items = [...(checklist.checkItems ?? [])]
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((item) => ({ text: item.name, done: item.state === 'complete' }))
    checklists.set(checklist.idCard, [...(checklists.get(checklist.idCard) ?? []), ...items])
  }
  const comments = new Map<string, ImportItem['comments']>()
  for (const action of board.actions ?? []) {
    if (action.type !== 'commentCard' || !action.data?.card?.id || !action.data.text) continue
    const list = comments.get(action.data.card.id) ?? []
    list.push({ author: action.memberCreator?.fullName, at: action.date, body: action.data.text })
    comments.set(action.data.card.id, list)
  }
  return (board.cards ?? [])
    .filter((card) => !card.closed && card.name?.trim())
    .map((card) => ({
      ref: card.idShort ? `#${card.idShort}` : card.id,
      title: card.name.trim().slice(0, 200),
      description: card.desc || undefined,
      status: lists.get(card.idList),
      assignee: card.idMembers?.[0] ? members.get(card.idMembers[0]) : undefined,
      labels: (card.labels ?? []).map((label) => label.name || label.color || '').filter(Boolean),
      dueDate: card.due ?? undefined,
      criteria: checklists.get(card.id) ?? [],
      comments: (comments.get(card.id) ?? []).reverse(),
    }))
}

// --- mapping values ----------------------------------------------------------------

/** Which category a status name from another tracker most likely means. */
export function guessCategory(name: string): StatusCategory {
  const text = name.toLowerCase()
  if (/cancel|won'?t|reject|declin|duplicate|invalid/.test(text)) return 'CANCELLED'
  if (/done|closed|resolved|complete|shipped|released|fixed|live/.test(text)) return 'DONE'
  if (/block|waiting|on hold|stuck/.test(text)) return 'BLOCKED'
  if (/review|qa|test|verify|uat|approval/.test(text)) return 'REVIEW'
  if (/progress|doing|develop|working|started|active/.test(text)) return 'IN_PROGRESS'
  if (/backlog|icebox|someday|later|idea/.test(text)) return 'BACKLOG'
  return 'TODO'
}

/**
 * A source value matched to one of ours: exactly by name, else — for statuses —
 * the first of ours in the same category; else null, which the person decides.
 */
export function matchValue<T extends { id: string; name: string; category?: StatusCategory }>(value: string, ours: T[], byCategory = false): T | null {
  const wanted = value.trim().toLowerCase()
  const exact = ours.find((entry) => entry.name.toLowerCase() === wanted)
  if (exact) return exact
  if (byCategory) {
    const category = guessCategory(value)
    return ours.find((entry) => entry.category === category) ?? null
  }
  const partial = ours.find((entry) => wanted.includes(entry.name.toLowerCase()) || entry.name.toLowerCase().includes(wanted))
  return partial ?? null
}

/** Distinct non-empty values of one field, most common first. */
export function distinctValues(items: ImportItem[], field: 'status' | 'type' | 'priority' | 'assignee' | 'reporter'): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const value = item[field]?.trim()
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
}
