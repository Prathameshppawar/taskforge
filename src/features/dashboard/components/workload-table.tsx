import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { WorkloadRow } from '../queries'

/**
 * Tabular view of the workload data.
 *
 * Present alongside the stacked chart deliberately: it is the accessible
 * fallback for anyone who cannot separate the series by colour, and it carries
 * the overdue count, which the chart does not encode.
 */
export function WorkloadTable({ rows }: { rows: WorkloadRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">Workload detail</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The same data as the chart, with overdue counts.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9">Person</TableHead>
            <TableHead className="h-9 text-right">Open</TableHead>
            <TableHead className="h-9 text-right">In progress</TableHead>
            <TableHead className="h-9 text-right">Blocked</TableHead>
            <TableHead className="h-9 text-right">Done</TableHead>
            <TableHead className="h-9 text-right">Overdue</TableHead>
            <TableHead className="h-9 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.userId}>
              <TableCell className="py-2">
                <span className="flex items-center gap-2">
                  <UserAvatar name={row.name} color={row.avatarColor} size="xs" />
                  <span className="truncate text-sm">{row.name}</span>
                </span>
              </TableCell>
              <TableCell className="py-2 text-right text-sm tabular-nums">{row.open}</TableCell>
              <TableCell className="py-2 text-right text-sm tabular-nums">
                {row.inProgress}
              </TableCell>
              <TableCell className="py-2 text-right text-sm tabular-nums">
                {row.blocked || '—'}
              </TableCell>
              <TableCell className="py-2 text-right text-sm tabular-nums">{row.done}</TableCell>
              <TableCell
                className={cn(
                  'py-2 text-right text-sm tabular-nums',
                  row.overdue > 0 && 'font-medium text-destructive',
                )}
              >
                {row.overdue || '—'}
              </TableCell>
              <TableCell className="py-2 text-right text-sm font-medium tabular-nums">
                {row.total}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
