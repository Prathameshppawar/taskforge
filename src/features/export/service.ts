/**
 * Turning a view into a file.
 *
 * The interesting part is not the formatting — it is that a spreadsheet is a
 * program, and every cell in this file was typed by somebody who may not be
 * trusted. See `escapeForCsv`.
 */

/**
 * Characters that make Excel treat a cell as a formula rather than text.
 *
 * Tab and carriage return are here because Excel strips leading whitespace
 * before deciding, so "\t=1+1" is still a formula.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutralises spreadsheet formula injection.
 *
 * A ticket titled `=cmd|'/c calc'!A0` is a *formula* when the CSV is opened in
 * Excel, so somebody whose only permission is to file a bug gets code execution
 * on whoever exports the board. Prefixing with an apostrophe marks the cell as
 * literal text; Excel shows the value and hides the prefix.
 *
 * This applies to CSV specifically. An XLSX string cell carries its type, so
 * Excel never re-interprets it — which is why the xlsx path does not do this
 * and would look wrong if it did.
 */
export function escapeForCsv(value: string): string {
  if (value.length === 0) return value
  return FORMULA_TRIGGERS.includes(value[0]) ? `'${value}` : value
}

/** RFC 4180 quoting: double the quotes, wrap anything with a delimiter. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  const guarded = escapeForCsv(raw)

  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export interface ExportColumn<T> {
  key: string
  header: string
  value: (row: T) => string | number | Date | null
  /** Width in characters, for the xlsx path. */
  width?: number
}

export function toCsv<T>(rows: readonly T[], columns: readonly ExportColumn<T>[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')]

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','))
  }

  /*
   * The BOM is not decoration. Without it Excel reads the file as the system's
   * legacy code page, and every name with an accent in it arrives mangled —
   * which is the single most common complaint about CSV exports.
   */
  return `﻿${lines.join('\r\n')}\r\n`
}

/** A filename that is safe in a header and recognisable in a downloads folder. */
export function exportFilename(prefix: string, extension: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10)
  const safe = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${safe || 'export'}-${stamp}.${extension}`
}
