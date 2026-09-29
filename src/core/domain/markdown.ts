/**
 * The Markdown tickets are written in, parsed to a small tree.
 *
 * Descriptions, remarks and comments are Markdown — the agents already write
 * it, and people paste it from everywhere. Parsing is pure and produces data,
 * not HTML: the renderer turns the tree into React nodes, so nothing a person,
 * an email or a model wrote is ever handed to `dangerouslySetInnerHTML`.
 *
 * Deliberately a subset, the one tickets need: headings, paragraphs, bullet,
 * numbered and task lists (one level of nesting), fenced code, quotes, rules
 * and tables; inline bold, italic, strikethrough, code, links, bare URLs,
 * ticket keys and @mentions.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'ticket'; key: string }
  | { type: 'mention'; username: string }
  | { type: 'break' }

export interface ListItem {
  /** Null for an ordinary item; a boolean for a task-list item. */
  checked: boolean | null
  children: Inline[]
  sublist?: Block
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'rule' }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }

// --- inline ------------------------------------------------------------------

/** Only http(s), mailto and in-app paths become links — never javascript: or data:. */
export function safeHref(href: string): string | null {
  const value = href.trim()
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value
  if (/^\/(?!\/)/.test(value)) return value
  return null
}

const TICKET_KEY = /^[A-Z][A-Z0-9]{1,9}-\d+/
const BARE_URL = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/
const MENTION = /^@([a-z0-9._-]{3,32})/i

/**
 * Inline syntax, scanned left to right. A delimiter only opens when a matching
 * close exists later on the line, so an unmatched `*` or `` ` `` stays text.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }

  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    const previous = i === 0 ? ' ' : source[i - 1]
    const atWordStart = !/[A-Za-z0-9_]/.test(previous)

    // Backslash escapes the next punctuation character.
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_~[\]()#+\-.!@>|]/.test(rest[1])) {
      text += rest[1]
      i += 2
      continue
    }

    if (rest.startsWith('  \n') || rest[0] === '\n') {
      flush()
      out.push({ type: 'break' })
      i += rest[0] === '\n' ? 1 : 3
      continue
    }

    if (rest[0] === '`') {
      const run = /^`+/.exec(rest)![0]
      const close = rest.indexOf(run, run.length)
      if (close > 0) {
        flush()
        out.push({ type: 'code', text: rest.slice(run.length, close).replace(/^ (.*) $/s, '$1') })
        i += close + run.length
        continue
      }
    }

    const emphasis = /^(\*\*|__|~~|\*|_)/.exec(rest)
    if (emphasis && (emphasis[1][0] !== '_' || atWordStart)) {
      const delimiter = emphasis[1]
      const close = findClose(rest, delimiter)
      if (close > delimiter.length) {
        flush()
        const children = parseInline(rest.slice(delimiter.length, close))
        const type = delimiter === '~~' ? 'del' : delimiter.length === 2 ? 'strong' : 'em'
        out.push({ type, children })
        i += close + delimiter.length
        continue
      }
    }

    if (rest[0] === '[') {
      const link = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/.exec(rest)
      if (link) {
        flush()
        const href = safeHref(link[2])
        const children = parseInline(link[1])
        if (href) out.push({ type: 'link', href, children })
        else out.push(...children)
        i += link[0].length
        continue
      }
    }

    if (atWordStart && (rest[0] === 'h' || rest[0] === 'H')) {
      const url = BARE_URL.exec(rest)
      if (url) {
        flush()
        out.push({ type: 'link', href: url[0], children: [{ type: 'text', text: url[0] }] })
        i += url[0].length
        continue
      }
    }

    if (atWordStart && rest[0] === '@') {
      const mention = MENTION.exec(rest)
      if (mention) {
        flush()
        out.push({ type: 'mention', username: mention[1].toLowerCase() })
        i += mention[0].length
        continue
      }
    }

    if (atWordStart && /[A-Z]/.test(rest[0])) {
      const key = TICKET_KEY.exec(rest)
      if (key && !/[A-Za-z0-9]/.test(rest[key[0].length] ?? ' ')) {
        flush()
        out.push({ type: 'ticket', key: key[0] })
        i += key[0].length
        continue
      }
    }

    text += rest[0]
    i += 1
  }

  flush()
  return out
}

/** Where `delimiter` closes, skipping code spans; -1 when it never does. */
function findClose(rest: string, delimiter: string): number {
  let j = delimiter.length
  while (j < rest.length) {
    if (rest[j] === '\\') {
      j += 2
      continue
    }
    if (rest[j] === '`') {
      const end = rest.indexOf('`', j + 1)
      if (end < 0) return -1
      j = end + 1
      continue
    }
    if (rest.startsWith(delimiter, j) && !/\s/.test(rest[j - 1])) {
      // `**` must not be read as a closing `*` of an outer `*…*`.
      if (delimiter.length === 1 && rest[j + 1] === delimiter) {
        j += 2
        continue
      }
      if (delimiter === '_' && /[A-Za-z0-9]/.test(rest[j + 1] ?? ' ')) {
        j += 1
        continue
      }
      return j
    }
    j += 1
  }
  return -1
}

// --- blocks ------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  return parseBlocks(lines)
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // the closing fence, or past the end if it was never closed
      blocks.push({ type: 'code', lang: fence[2] || null, text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3
      blocks.push({ type: 'heading', level, children: parseInline(heading[2]) })
      i += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1])
        i += 1
      }
      blocks.push({ type: 'quote', children: parseBlocks(body) })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitRow(line).map(parseInline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        const cells = splitRow(lines[i])
        rows.push(header.map((_, index) => parseInline(cells[index] ?? '')))
        i += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item && item[1].length <= 3) {
      const { block, next } = parseList(lines, i)
      blocks.push(block)
      i = next
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const body: string[] = [line.trim()]
    i += 1
    while (i < lines.length) {
      const candidate = lines[i]
      if (
        candidate.trim() === '' ||
        FENCE.test(candidate) ||
        HEADING.test(candidate) ||
        QUOTE.test(candidate) ||
        RULE.test(candidate) ||
        (LIST_ITEM.test(candidate) && LIST_ITEM.exec(candidate)![1].length <= 3)
      ) {
        break
      }
      body.push(candidate.trim())
      i += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(body.join('\n')) })
  }

  return blocks
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST_ITEM.exec(lines[start])!
  const indent = first[1].length
  const ordered = /\d/.test(first[2])
  const items: ListItem[] = []
  let i = start

  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i])
    if (!match || match[1].length !== indent || /\d/.test(match[2]) !== ordered) break

    const task = TASK.exec(match[3])
    const texts = [task ? task[2] : match[3]]
    i += 1

    // Continuation lines and one level of nested list.
    let sublist: Block | undefined
    while (i < lines.length && lines[i].trim() !== '') {
      const nested = LIST_ITEM.exec(lines[i])
      if (nested && nested[1].length > indent) {
        const parsed = parseList(lines, i)
        sublist = parsed.block
        i = parsed.next
        continue
      }
      if (nested) break
      if (!/^\s/.test(lines[i])) break
      texts.push(lines[i].trim())
      i += 1
    }

    items.push({
      checked: task ? task[1] !== ' ' : null,
      children: parseInline(texts.join('\n')),
      ...(sublist ? { sublist } : {}),
    })

    // A single blank line between items keeps the list going.
    if (i + 1 < lines.length && lines[i]?.trim() === '') {
      const after = LIST_ITEM.exec(lines[i + 1])
      if (after && after[1].length === indent && /\d/.test(after[2]) === ordered) i += 1
    }
  }

  return {
    block: { type: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items },
    next: i,
  }
}

/** Markdown as plain text — for previews, notifications and email subjects. */
export function markdownToPlain(source: string): string {
  const inline = (nodes: Inline[]): string =>
    nodes
      .map((node) => {
        switch (node.type) {
          case 'text':
          case 'code':
            return node.text
          case 'break':
            return ' '
          case 'ticket':
            return node.key
          case 'mention':
            return `@${node.username}`
          default:
            return inline(node.children)
        }
      })
      .join('')

  const block = (node: Block): string => {
    switch (node.type) {
      case 'heading':
      case 'paragraph':
        return inline(node.children)
      case 'list':
        return node.items.map((item) => `• ${inline(item.children)}${item.sublist ? ` ${block(item.sublist)}` : ''}`).join(' ')
      case 'code':
        return node.text
      case 'quote':
        return node.children.map(block).join(' ')
      case 'rule':
        return ''
      case 'table':
        return [node.header, ...node.rows].map((row) => row.map(inline).join(' · ')).join(' ')
    }
  }

  return parseMarkdown(source).map(block).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Task-list items in a description, as acceptance-criteria candidates:
 * "- [ ] Works offline" → { text: 'Works offline', done: false }.
 */
export function extractTaskItems(source: string): Array<{ text: string; done: boolean }> {
  const found: Array<{ text: string; done: boolean }> = []
  const walk = (blocks: Block[]) => {
    for (const node of blocks) {
      if (node.type === 'list') {
        for (const item of node.items) {
          if (item.checked !== null) {
            const text = markdownToPlain(sourceOf(item.children))
            if (text) found.push({ text, done: item.checked })
          }
          if (item.sublist) walk([item.sublist])
        }
      } else if (node.type === 'quote') {
        walk(node.children)
      }
    }
  }
  walk(parseMarkdown(source))
  return found
}

/** Inline nodes back to Markdown-ish source, enough for plain-text conversion. */
function sourceOf(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text
        case 'code':
          return `\`${node.text}\``
        case 'break':
          return ' '
        case 'ticket':
          return node.key
        case 'mention':
          return `@${node.username}`
        case 'link':
          return sourceOf(node.children)
        default:
          return sourceOf(node.children)
      }
    })
    .join('')
}
