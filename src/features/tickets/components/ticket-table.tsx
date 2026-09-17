'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
  type GroupingState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Group,
  MoreHorizontal,
  Trash2,
  ArrowUpDown,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn, isOverdue } from '@/lib/utils'
import { isTerminal } from '@/core/domain/ticket-rules'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LabelChip, PriorityBadge, StatusBadge, TypeBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { InlineStatusCell, InlineAssigneeCell, InlinePriorityCell } from './inline-cells'
import { BulkActionBar } from './bulk-action-bar'
import { deleteTicketAction } from '../actions'
import type { TicketListItem } from '../queries'

/**
 * The slice of context the table needs. Satisfied by both the single-project
 * context and the cross-project workspace context.
 */
export interface TicketTableContext {
  statuses: Array<{ id: string; name: string; color: string }>
  priorities: Array<{ id: string; name: string; color: string; level: number }>
  members: Array<{ id: string; name: string; username: string; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  can: { updateTicket: boolean; deleteTicket: boolean }
}

/**
 * Table view.
 *
 * Sorting, grouping and column visibility are client-side because the server
 * already returns the filtered result set — re-querying for a sort would be a
 * round-trip for data the browser is holding. Inline edits go straight to the
 * Server Action and then revalidate.
 */
export function TicketTable({
  tickets,
  context,
  showProjectColumn = false,
}: {
  tickets: TicketListItem[]
  context: TicketTableContext
  showProjectColumn?: boolean
}) {
  const router = useRouter()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [grouping, setGrouping] = React.useState<GroupingState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    reporter: false,
    storyPoints: false,
    createdAt: false,
    project: showProjectColumn,
  })

  const canEdit = context.can.updateTicket

  const columns = React.useMemo<ColumnDef<TicketListItem>[]>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        enableHiding: false,
        enableGrouping: false,
        size: 36,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            aria-label="Select row"
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      {
        accessorKey: 'key',
        header: 'Key',
        enableGrouping: false,
        size: 100,
        cell: ({ row }) => (
          <Link
            href={`/tickets/${row.original.key}`}
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            {row.original.key}
          </Link>
        ),
      },
      {
        accessorKey: 'title',
        header: 'Title',
        enableGrouping: false,
        size: 400,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            {row.original.parent && (
              <span
                className="shrink-0 font-mono text-[10px] text-muted-foreground"
                title={`Child of ${row.original.parent.key}`}
              >
                ↳
              </span>
            )}
            <Link
              href={`/tickets/${row.original.key}`}
              className="truncate text-sm font-medium hover:underline"
            >
              {row.original.title}
            </Link>
            {row.original._count.children > 0 && (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {row.original._count.children}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'project',
        accessorFn: (row) => row.project.name,
        header: 'Project',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.project.code}</span>
        ),
      },
      {
        id: 'status',
        accessorFn: (row) => row.status.name,
        header: 'Status',
        size: 150,
        cell: ({ row }) =>
          canEdit ? (
            <InlineStatusCell
              ticketId={row.original.id}
              current={row.original.status}
              options={context.statuses}
            />
          ) : (
            <StatusBadge name={row.original.status.name} color={row.original.status.color} />
          ),
      },
      {
        id: 'priority',
        accessorFn: (row) => row.priority.name,
        sortingFn: (a, b) => a.original.priority.level - b.original.priority.level,
        header: 'Priority',
        size: 130,
        cell: ({ row }) =>
          canEdit ? (
            <InlinePriorityCell
              ticketId={row.original.id}
              current={row.original.priority}
              options={context.priorities}
            />
          ) : (
            <PriorityBadge
              name={row.original.priority.name}
              color={row.original.priority.color}
              level={row.original.priority.level}
            />
          ),
      },
      {
        id: 'type',
        accessorFn: (row) => row.type.name,
        header: 'Type',
        size: 120,
        cell: ({ row }) => (
          <TypeBadge name={row.original.type.name} color={row.original.type.color} />
        ),
      },
      {
        id: 'assignee',
        accessorFn: (row) => row.assignee?.name ?? 'Unassigned',
        header: 'Assignee',
        size: 170,
        cell: ({ row }) =>
          canEdit ? (
            <InlineAssigneeCell
              ticketId={row.original.id}
              current={row.original.assignee}
              options={context.members}
            />
          ) : row.original.assignee ? (
            <span className="flex items-center gap-1.5">
              <UserAvatar
                name={row.original.assignee.name}
                color={row.original.assignee.avatarColor}
                size="xs"
              />
              <span className="truncate text-xs">{row.original.assignee.name}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          ),
      },
      {
        id: 'reporter',
        accessorFn: (row) => row.reporter?.name ?? '—',
        header: 'Reporter',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.reporter?.name ?? '—'}
          </span>
        ),
      },
      {
        id: 'labels',
        accessorFn: (row) => row.labels.map((l) => l.label.name).join(', '),
        header: 'Labels',
        enableSorting: false,
        size: 200,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.labels.slice(0, 2).map(({ label }) => (
              <LabelChip key={label.id} name={label.name} color={label.color} />
            ))}
            {row.original.labels.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{row.original.labels.length - 2}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'dueDate',
        accessorFn: (row) => row.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER,
        header: 'Due',
        enableGrouping: false,
        size: 110,
        cell: ({ row }) => {
          const overdue = isOverdue(
            row.original.dueDate,
            isTerminal(row.original.status.category),
          )
          return row.original.dueDate ? (
            <span className={cn('text-xs', overdue && 'font-medium text-destructive')}>
              {row.original.dueDate.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
        },
      },
      {
        id: 'storyPoints',
        accessorFn: (row) => row.storyPoints ?? 0,
        header: 'Points',
        size: 80,
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">{row.original.storyPoints ?? '—'}</span>
        ),
      },
      {
        id: 'createdAt',
        accessorFn: (row) => row.createdAt.getTime(),
        header: 'Created',
        enableGrouping: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.createdAt.toLocaleDateString()}
          </span>
        ),
      },
      {
        id: 'actions',
        enableSorting: false,
        enableHiding: false,
        enableGrouping: false,
        size: 44,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Actions for {row.original.key}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/tickets/${row.original.key}`}>Open ticket</Link>
              </DropdownMenuItem>
              {context.can.deleteTicket && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={async () => {
                      const result = await deleteTicketAction({ ticketId: row.original.id })
                      if (!result.success) toast.error(result.error)
                      else {
                        toast.success(`${row.original.key} deleted.`)
                        router.refresh()
                      }
                    }}
                  >
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [canEdit, context, router],
  )

  const table = useReactTable({
    data: tickets,
    columns,
    state: { sorting, grouping, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowId: (row) => row.id,
    autoResetExpanded: false,
  })

  const selectedIds = Object.keys(rowSelection)

  return (
    <div className="flex h-full flex-col">
      {/* Table controls */}
      <div className="flex items-center gap-2 border-b px-4 py-2 sm:px-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Group className="size-3.5" />
              {grouping.length > 0 ? `Grouped by ${grouping[0]}` : 'Group'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Group rows by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGrouping([])}>None</DropdownMenuItem>
            {['status', 'priority', 'type', 'assignee', 'labels'].map((column) => (
              <DropdownMenuItem key={column} onSelect={() => setGrouping([column])}>
                <span className="capitalize">{column}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Columns3 className="size-3.5" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                  onSelect={(event) => event.preventDefault()}
                  className="capitalize"
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {table.getRowModel().rows.length} rows
        </span>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="h-9 whitespace-nowrap"
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown
                          className={cn(
                            'size-3',
                            header.column.getIsSorted() ? 'opacity-100' : 'opacity-30',
                          )}
                        />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <p className="text-sm text-muted-foreground">
                    No tickets match the current filters.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className={cn(row.getIsGrouped() && 'bg-muted/40 font-medium')}
                >
                  {row.getVisibleCells().map((cell) => {
                    if (cell.getIsGrouped()) {
                      return (
                        <TableCell key={cell.id} colSpan={1}>
                          <button
                            type="button"
                            onClick={row.getToggleExpandedHandler()}
                            className="inline-flex items-center gap-1.5 text-sm"
                          >
                            {row.getIsExpanded() ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            <span className="text-xs text-muted-foreground">
                              ({row.subRows.length})
                            </span>
                          </button>
                        </TableCell>
                      )
                    }

                    if (cell.getIsAggregated()) {
                      return <TableCell key={cell.id} />
                    }

                    return (
                      <TableCell
                        key={cell.id}
                        className={cn('py-1.5', cell.getIsPlaceholder() && 'opacity-0')}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selectedIds.length > 0 && (
        <BulkActionBar
          ticketIds={selectedIds}
          context={context}
          onDone={() => setRowSelection({})}
        />
      )}
    </div>
  )
}
