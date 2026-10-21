import * as React from 'react'

import { diffStats, lineDiff, type DiffLine } from '@/core/domain/project-documents'

/** Unchanged lines kept on each side of a change. */
const CONTEXT = 3

/**
 * A line-by-line diff of a document: additions and removals, with long runs of
 * unchanged lines collapsed to one marker. Server-compatible.
 */
export function DocumentDiff({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after)
  const { added, removed } = diffStats(lines)

  if (added === 0 && removed === 0) {
    return <p className="text-sm text-muted-foreground">No differences.</p>
  }

  const shown = lines.map((_, index) => isNearChange(lines, index))
  const rows: React.ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    if (shown[index]) {
      rows.push(<DiffRow key={index} line={lines[index]} />)
      index++
      continue
    }
    const start = index
    while (index < lines.length && !shown[index]) index++
    rows.push(
      <div key={`gap-${start}`} className="bg-muted/40 px-3 text-muted-foreground/70 italic">
        … {index - start} unchanged lines
      </div>,
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">
        <span className="text-emerald-600">+{added}</span> <span className="text-red-600">−{removed}</span> lines
      </p>
      <div className="overflow-x-auto rounded-lg border font-mono text-xs leading-5">{rows}</div>
    </div>
  )
}

/** A line is shown when it changed, or sits within the context window of a change. */
function isNearChange(lines: DiffLine[], index: number): boolean {
  const from = Math.max(0, index - CONTEXT)
  const to = Math.min(lines.length - 1, index + CONTEXT)
  for (let i = from; i <= to; i++) {
    if (lines[i].op !== 'same') return true
  }
  return false
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.op === 'add') {
    return (
      <div className="whitespace-pre-wrap break-words bg-emerald-500/10 px-3 text-emerald-900 dark:text-emerald-200">
        + {line.text}
      </div>
    )
  }
  if (line.op === 'remove') {
    return (
      <div className="whitespace-pre-wrap break-words bg-red-500/10 px-3 text-red-900 line-through decoration-red-400/40 dark:text-red-200">
        − {line.text}
      </div>
    )
  }
  return <div className="whitespace-pre-wrap break-words px-3 text-muted-foreground">  {line.text}</div>
}
