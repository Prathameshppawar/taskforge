'use client'

import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { parseTicketKey } from '@/core/domain/ticket-rules'

/**
 * Minimal Markdown renderer for Copilot replies.
 *
 * Deliberately not react-markdown: the panel needs six constructs, and a
 * hand-rolled renderer keeps the client bundle small and — more importantly —
 * builds React nodes rather than HTML. Nothing model-generated is ever passed
 * to dangerouslySetInnerHTML, so a reply cannot inject markup.
 *
 * Supported: **bold**, *italic*, `code`, bullet and numbered lists,
 * [links](url), and bare ticket keys like RC-14, which become real links.
 */

// The link arm allows one level of nested parentheses, so a URL such as
// `alert(1)` is captured whole instead of stopping at the first ")" and
// leaving a stray bracket in the output.
const LINK = String.raw`\[[^\]]+\]\((?:[^()]|\([^()]*\))*\)`
const INLINE = new RegExp(
  `(\\*\\*[^*]+\\*\\*|\\*[^*\\n]+\\*|\`[^\`]+\`|${LINK}|\\b[A-Z][A-Z0-9]{1,9}-\\d+\\b)`,
  'g',
)

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== undefined && p !== '')

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    const linkMatch = /^\[([^\]]+)\]\((.*)\)$/s.exec(part)
    if (linkMatch) {
      const [, label, href] = linkMatch
      // Only http(s) and in-app paths — never javascript: or data: URLs.
      const safe = /^(https?:\/\/|\/)/i.test(href)
      if (!safe) return <React.Fragment key={key}>{label}</React.Fragment>

      return (
        <a
          key={key}
          href={href}
          target={href.startsWith('/') ? undefined : '_blank'}
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {label}
        </a>
      )
    }

    // A bare ticket key becomes a link — the Copilot refers to tickets
    // constantly and typing the key out again to find it is friction.
    if (parseTicketKey(part)) {
      return (
        <Link
          key={key}
          href={`/tickets/${part.toUpperCase()}`}
          className="font-mono text-[0.9em] text-primary underline underline-offset-2"
        >
          {part}
        </Link>
      )
    }

    return <React.Fragment key={key}>{part}</React.Fragment>
  })
}

export function MarkdownText({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const blocks = React.useMemo(() => {
    const lines = content.split('\n')
    const out: React.ReactNode[] = []
    let list: { ordered: boolean; items: string[] } | null = null

    const flush = () => {
      if (!list) return
      const Tag = list.ordered ? 'ol' : 'ul'
      out.push(
        <Tag
          key={`l-${out.length}`}
          className={cn(
            'my-1 space-y-0.5 pl-4',
            list.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {list.items.map((item, i) => (
            <li key={i}>{renderInline(item, `li-${out.length}-${i}`)}</li>
          ))}
        </Tag>,
      )
      list = null
    }

    lines.forEach((raw, index) => {
      const line = raw.trimEnd()

      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)

      if (bullet) {
        if (!list || list.ordered) { flush(); list = { ordered: false, items: [] } }
        list.items.push(bullet[1])
        return
      }
      if (numbered) {
        if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] } }
        list.items.push(numbered[1])
        return
      }

      flush()

      if (line.trim() === '') return

      // A heading is rendered as emphasis, not an <h*> — the panel is narrow
      // and large headings there look broken.
      const heading = /^#{1,6}\s+(.*)$/.exec(line)
      if (heading) {
        out.push(
          <p key={`h-${index}`} className="mt-2 font-semibold first:mt-0">
            {renderInline(heading[1], `h-${index}`)}
          </p>,
        )
        return
      }

      out.push(
        <p key={`p-${index}`} className="whitespace-pre-wrap">
          {renderInline(line, `p-${index}`)}
        </p>,
      )
    })

    flush()
    return out
  }, [content])

  return <div className={cn('space-y-1.5 text-sm leading-relaxed', className)}>{blocks}</div>
}
