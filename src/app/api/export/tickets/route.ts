import { NextResponse, type NextRequest } from 'next/server'
import writeXlsxFile from 'write-excel-file/node'

import { requireActor } from '@/features/auth/guards'
import { parseFiltersFromParams } from '@/features/filters/types'
import { collectTickets, selectColumns } from '@/features/export/tickets'
import { exportFilename, toCsv } from '@/features/export/service'

/**
 * Exports the current view as a spreadsheet.
 *
 * It takes the same query string the table reads, so "export" means "this
 * filtered, sorted view" rather than "everything" — which is the difference
 * between a file a PM can use and one they have to clean up first.
 *
 * Node runtime: Prisma, and the xlsx writer streams to a buffer.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const actor = await requireActor()

  const params = Object.fromEntries(request.nextUrl.searchParams.entries())
  const filters = parseFiltersFromParams(params)
  const projectId = params.project || undefined
  const format = params.format === 'xlsx' ? 'xlsx' : 'csv'

  const columns = selectColumns(params.columns?.split(',').filter(Boolean))
  const { rows, total, truncated } = await collectTickets(actor, filters, projectId)

  const name = exportFilename(params.name || 'tickets', format)

  // Told, not hidden: a silently truncated export is one somebody reports on.
  const truncationHeader: Record<string, string> = truncated
    ? { 'X-Export-Truncated': `${rows.length} of ${total}` }
    : {}

  if (format === 'csv') {
    return new NextResponse(toCsv(rows, columns), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        ...truncationHeader,
      },
    })
  }

  /*
   * XLSX carries a type per cell, so dates arrive as dates and numbers sort as
   * numbers — the two things people actually open a spreadsheet to do, and the
   * two things CSV cannot express.
   *
   * No formula-escaping here on purpose: a string cell in xlsx is typed as a
   * string and Excel never re-evaluates it. That guard belongs to CSV, which
   * has no types. Escaping here would put a stray apostrophe in every title
   * beginning with a minus sign.
   */
  const schema = columns.map((column) => {
    const sample = rows.find((row) => column.value(row) instanceof Date)
    const isDate = Boolean(sample)

    return {
      column: column.header,
      width: column.width,
      type: isDate ? Date : String,
      format: isDate ? 'yyyy-mm-dd' : undefined,
      value: (row: (typeof rows)[number]) => {
        const value = column.value(row)
        if (value === null || value === undefined || value === '') return undefined
        return isDate ? (value as Date) : String(value)
      },
    }
  })

  const buffer = await writeXlsxFile(rows, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: schema as any,
    buffer: true,
  })

  return new NextResponse(new Uint8Array(buffer as Buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      ...truncationHeader,
    },
  })
}
