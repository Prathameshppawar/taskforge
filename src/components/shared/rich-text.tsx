import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { parseMarkdown, type Block, type Inline } from '@/core/domain/markdown'

/**
 * Ticket Markdown, rendered as React nodes.
 *
 * Works in server and client components alike (no hooks). Everything goes
 * through `parseMarkdown`, which produces data; links were already restricted
 * to http(s), mailto and in-app paths there.
 */
export function RichText({
  content,
  className,
  compact = false,
  ticketBase = '/tickets/',
}: {
  content: string
  className?: string
  /** Tighter spacing, for comments. */
  compact?: boolean
  ticketBase?: string
}) {
  const blocks = parseMarkdown(content)
  return (
    <div
      className={cn(
        'min-w-0 text-sm leading-relaxed break-words',
        compact ? 'space-y-1.5' : 'space-y-2.5',
        className,
      )}
    >
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} base={ticketBase} />
      ))}
    </div>
  )
}

/** `base` is where ticket keys link: the app, or the client portal. */
function BlockNode({ block, base }: { block: Block; base: string }) {
  switch (block.type) {
    case 'heading': {
      const classes = {
        1: 'text-[15px] font-semibold',
        2: 'text-sm font-semibold',
        3: 'text-sm font-medium text-muted-foreground',
      }[block.level]
      const Tag = `h${block.level + 2}` as 'h3' | 'h4' | 'h5'
      return (
        <Tag className={cn(classes, 'pt-1')}>
          <InlineNodes nodes={block.children} base={base} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <InlineNodes nodes={block.children} base={base} />
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      const isTasks = block.items.every((item) => item.checked !== null)
      return (
        <Tag
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn(
            'space-y-0.5',
            isTasks ? 'pl-0.5' : block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5',
          )}
        >
          {block.items.map((item, index) => (
            <li key={index} className={cn(item.checked !== null && 'flex list-none items-start gap-2')}>
              {item.checked !== null && (
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  disabled
                  aria-label={item.checked ? 'Done' : 'Not done'}
                  className="mt-1 size-3.5 shrink-0 accent-primary"
                />
              )}
              <span className={cn(item.checked && 'text-muted-foreground line-through')}>
                <InlineNodes nodes={item.children} base={base} />
              </span>
              {item.sublist && <BlockNode block={item.sublist} base={base} />}
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md border bg-muted/60 p-3 font-mono text-[12.5px] leading-snug">
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote className="space-y-1.5 border-l-2 pl-3 text-muted-foreground">
          {block.children.map((child, index) => (
            <BlockNode key={index} block={child} base={base} />
          ))}
        </blockquote>
      )
    case 'rule':
      return <hr className="border-border" />
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} className="border-b px-2 py-1 text-left font-medium">
                    <InlineNodes nodes={cell} base={base} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b last:border-0">
                  {row.map((cell, index) => (
                    <td key={index} className="px-2 py-1 align-top">
                      <InlineNodes nodes={cell} base={base} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function InlineNodes({ nodes, base }: { nodes: Inline[]; base: string }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNode key={index} node={node} base={base} />
      ))}
    </>
  )
}

function InlineNode({ node, base }: { node: Inline; base: string }) {
  switch (node.type) {
    case 'text':
      return <>{node.text}</>
    case 'break':
      return <br />
    case 'strong':
      return (
        <strong className="font-semibold">
          <InlineNodes nodes={node.children} base={base} />
        </strong>
      )
    case 'em':
      return (
        <em>
          <InlineNodes nodes={node.children} base={base} />
        </em>
      )
    case 'del':
      return (
        <del className="text-muted-foreground">
          <InlineNodes nodes={node.children} base={base} />
        </del>
      )
    case 'code':
      return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node.text}</code>
    case 'link': {
      const internal = node.href.startsWith('/')
      return internal ? (
        <Link href={node.href} className="text-primary underline underline-offset-2">
          <InlineNodes nodes={node.children} base={base} />
        </Link>
      ) : (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
        >
          <InlineNodes nodes={node.children} base={base} />
        </a>
      )
    }
    case 'ticket':
      return <TicketKey ticketKey={node.key} base={base} />
    case 'mention':
      return <span className="rounded bg-primary/10 px-1 font-medium text-primary">@{node.username}</span>
  }
}

function TicketKey({ ticketKey, base }: { ticketKey: string; base: string }) {
  return (
    <Link
      href={`${base}${ticketKey}`}
      className="font-mono text-[0.9em] text-primary underline-offset-2 hover:underline"
    >
      {ticketKey}
    </Link>
  )
}
