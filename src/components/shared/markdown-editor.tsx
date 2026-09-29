'use client'

import * as React from 'react'
import { Bold, Code, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Quote } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { RichText } from '@/components/shared/rich-text'

/**
 * A Markdown textarea with a toolbar and a preview.
 *
 * A plain textarea underneath, on purpose: it works with every paste, every
 * browser extension and every screen reader, and what is stored is exactly
 * what was typed. The toolbar only inserts syntax. ⌘B / ⌘I / ⌘K format the
 * selection; ⌘↵ calls `onSubmit`.
 */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 6,
  disabled,
  autoFocus,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  className?: string
  'aria-label'?: string
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = React.useState(false)

  /** Wraps the selection, or inserts a placeholder and selects it. */
  function wrap(before: string, after = before, fallback = 'text') {
    const area = ref.current
    if (!area) return
    const { selectionStart: start, selectionEnd: end } = area
    const selected = value.slice(start, end) || fallback
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  /** Prefixes every selected line (or the current one). */
  function prefixLines(prefix: (index: number) => string) {
    const area = ref.current
    if (!area) return
    const { selectionStart, selectionEnd } = area
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const lineEndIndex = value.indexOf('\n', selectionEnd)
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
    const lines = value.slice(lineStart, lineEnd).split('\n')
    const replaced = lines.map((line, index) => prefix(index) + line).join('\n')
    onChange(value.slice(0, lineStart) + replaced + value.slice(lineEnd))
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(lineStart, lineStart + replaced.length)
    })
  }

  const tools: Array<{ label: string; icon: React.ElementType; run: () => void }> = [
    { label: 'Heading', icon: Heading2, run: () => prefixLines(() => '## ') },
    { label: 'Bold (⌘B)', icon: Bold, run: () => wrap('**') },
    { label: 'Italic (⌘I)', icon: Italic, run: () => wrap('*') },
    { label: 'Code', icon: Code, run: () => wrap('`', '`', 'code') },
    { label: 'Link (⌘K)', icon: Link2, run: () => wrap('[', '](https://)', 'link text') },
    { label: 'Quote', icon: Quote, run: () => prefixLines(() => '> ') },
    { label: 'Bulleted list', icon: List, run: () => prefixLines(() => '- ') },
    { label: 'Numbered list', icon: ListOrdered, run: () => prefixLines((index) => `${index + 1}. `) },
    { label: 'Checklist', icon: ListChecks, run: () => prefixLines(() => '- [ ] ') },
  ]

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === 'Enter' && onSubmit) {
      event.preventDefault()
      onSubmit()
      return
    }
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === 'b') {
      event.preventDefault()
      wrap('**')
    } else if (key === 'i') {
      event.preventDefault()
      wrap('*')
    } else if (key === 'k') {
      event.preventDefault()
      wrap('[', '](https://)', 'link text')
    }
  }

  return (
    <div className={cn('rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        <div role="tablist" aria-label="Editor mode" className="mr-1 flex gap-0.5">
          {(['Write', 'Preview'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={(mode === 'Preview') === preview}
              onClick={() => setPreview(mode === 'Preview')}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                (mode === 'Preview') === preview ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        {!preview &&
          tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              disabled={disabled}
              onClick={tool.run}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <tool.icon className="size-3.5" />
            </button>
          ))}
        <span className="ml-auto hidden pr-1 text-[10px] text-muted-foreground sm:inline">Markdown</span>
      </div>

      {preview ? (
        <div className="min-h-24 px-3 py-2">
          {value.trim() ? (
            <RichText content={value} />
          ) : (
            <p className="text-sm text-muted-foreground italic">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <Textarea
          ref={ref}
          id={id}
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          className="rounded-none border-0 font-mono text-[13px] shadow-none focus-visible:ring-0 md:text-[13px]"
        />
      )}
    </div>
  )
}
