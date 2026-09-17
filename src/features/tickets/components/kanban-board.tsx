'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TicketCard } from './ticket-card'
import { moveTicketAction } from '../actions'
import type { TicketListItem } from '../queries'

export interface BoardColumn {
  status: {
    id: string
    name: string
    color: string
    category: string
    position: number
  }
  tickets: TicketListItem[]
}

/**
 * Kanban board.
 *
 * State is optimistic: the card moves on drop and only reconciles with the
 * server afterwards, because a round-trip on every drag feels broken. If the
 * action fails the previous arrangement is restored and the user is told why.
 *
 * Ordering uses sparse float positions, so a drop rewrites one row rather than
 * reindexing the whole column.
 */
export function KanbanBoard({
  columns: initialColumns,
  canEdit,
  onCreateTicket,
}: {
  columns: BoardColumn[]
  canEdit: boolean
  onCreateTicket?: (statusId: string) => void
}) {
  const router = useRouter()
  const [columns, setColumns] = React.useState(initialColumns)
  const [activeTicket, setActiveTicket] = React.useState<TicketListItem | null>(null)

  // Re-sync when the server sends new data (filters changed, revalidation).
  React.useEffect(() => setColumns(initialColumns), [initialColumns])

  const sensors = useSensors(
    // A small activation distance keeps a click on the ticket key from being
    // swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ticketsById = React.useMemo(() => {
    const map = new Map<string, { ticket: TicketListItem; statusId: string }>()
    for (const column of columns) {
      for (const ticket of column.tickets) {
        map.set(ticket.id, { ticket, statusId: column.status.id })
      }
    }
    return map
  }, [columns])

  function handleDragStart(event: DragStartEvent) {
    const entry = ticketsById.get(String(event.active.id))
    setActiveTicket(entry?.ticket ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTicket(null)
    if (!over) return

    const ticketId = String(active.id)
    const source = ticketsById.get(ticketId)
    if (!source) return

    // The drop target is either a column (its status id) or another card.
    const overId = String(over.id)
    const overColumn = columns.find((c) => c.status.id === overId)
    const overTicket = ticketsById.get(overId)
    const destinationStatusId = overColumn?.status.id ?? overTicket?.statusId

    if (!destinationStatusId) return

    const destination = columns.find((c) => c.status.id === destinationStatusId)
    if (!destination) return

    // Work out the neighbours at the drop point for midpoint positioning.
    const siblings = destination.tickets.filter((t) => t.id !== ticketId)
    const dropIndex = overTicket
      ? siblings.findIndex((t) => t.id === overTicket.ticket.id)
      : siblings.length

    const insertAt = dropIndex === -1 ? siblings.length : dropIndex
    const before = insertAt > 0 ? siblings[insertAt - 1].position : null
    const after = insertAt < siblings.length ? siblings[insertAt].position : null

    if (source.statusId === destinationStatusId && before === null && after === null) return

    const previous = columns

    // --- optimistic move ------------------------------------------------------
    const moved: TicketListItem = {
      ...source.ticket,
      status: { ...destination.status, category: destination.status.category as never },
    }

    setColumns((current) =>
      current.map((column) => {
        if (column.status.id === source.statusId && column.status.id === destinationStatusId) {
          const rest = column.tickets.filter((t) => t.id !== ticketId)
          rest.splice(insertAt, 0, moved)
          return { ...column, tickets: rest }
        }
        if (column.status.id === source.statusId) {
          return { ...column, tickets: column.tickets.filter((t) => t.id !== ticketId) }
        }
        if (column.status.id === destinationStatusId) {
          const rest = [...column.tickets]
          rest.splice(insertAt, 0, moved)
          return { ...column, tickets: rest }
        }
        return column
      }),
    )

    // --- persist --------------------------------------------------------------
    void (async () => {
      const result = await moveTicketAction({
        ticketId,
        statusId: destinationStatusId,
        beforePosition: before,
        afterPosition: after,
      })

      if (!result.success) {
        setColumns(previous)
        toast.error(result.error)
        return
      }

      // Pull the authoritative state, including any parent status rollup the
      // move may have triggered.
      router.refresh()
    })()
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTicket(null)}
    >
      <div className="board-scroll flex h-full gap-3 overflow-x-auto p-4 sm:px-6">
        {columns.map((column) => (
          <Column
            key={column.status.id}
            column={column}
            canEdit={canEdit}
            onCreateTicket={onCreateTicket}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeTicket ? (
          <div className="w-72">
            <TicketCard ticket={activeTicket} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  column,
  canEdit,
  onCreateTicket,
}: {
  column: BoardColumn
  canEdit: boolean
  onCreateTicket?: (statusId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status.id })

  return (
    <section
      className="board-column flex w-72 shrink-0 flex-col rounded-xl bg-muted/40"
      aria-label={`${column.status.name} column`}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <span
          className={cn('size-2 rounded-full', colorClasses(column.status.color).dot)}
          aria-hidden
        />
        <h3 className="text-sm font-medium">{column.status.name}</h3>
        <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
          {column.tickets.length}
        </span>
        {canEdit && onCreateTicket && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-6"
            onClick={() => onCreateTicket(column.status.id)}
            aria-label={`Add ticket to ${column.status.name}`}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={setNodeRef}
          className={cn(
            'flex min-h-24 flex-col gap-2 px-2 pb-3 transition-colors',
            isOver && 'rounded-lg bg-primary/5',
          )}
        >
          <SortableContext
            items={column.tickets.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {column.tickets.map((ticket) => (
              <SortableTicket key={ticket.id} ticket={ticket} disabled={!canEdit} />
            ))}
          </SortableContext>

          {column.tickets.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Nothing here
            </p>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

function SortableTicket({
  ticket,
  disabled,
}: {
  ticket: TicketListItem
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(!disabled && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-40')}
    >
      <TicketCard ticket={ticket} />
    </div>
  )
}
