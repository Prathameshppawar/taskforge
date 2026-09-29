'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowRightLeft,
  Ban,
  BarChart3,
  CalendarRange,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { PriorityBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import type { PlanTicket, Planning } from '../queries'
import {
  applyScopeAction,
  arrangeAction,
  askPlannerAction,
  deleteCycleAction,
  proposeFillAction,
  startCycleAction,
  type ScopeProposal,
} from '../actions'
import { CycleDialog, type CycleFormValue } from './cycle-dialog'
import { CloseCycleDialog } from './close-cycle-dialog'
import { ProposalDialog } from './proposal-dialog'

const BACKLOG = 'backlog'

type Section = { id: string; tickets: PlanTicket[] }

/**
 * Planning: every open sprint and milestone above the ranked backlog.
 *
 * Drag a ticket between lists or within one to rank it; or use its menu, which
 * does the same without a pointer. The order is optimistic and reconciled with
 * the server after each move, like the board.
 */
export function PlanningBoard({
  projectId,
  planning,
  canPlan,
  canManage,
  plannerAvailable,
}: {
  projectId: string
  planning: Planning
  canPlan: boolean
  canManage: boolean
  plannerAvailable: boolean
}) {
  const router = useRouter()
  const initial = React.useMemo<Section[]>(
    () => [...planning.cycles.map((cycle) => ({ id: cycle.id, tickets: cycle.tickets })), { id: BACKLOG, tickets: planning.backlog }],
    [planning],
  )
  const [sections, setSections] = React.useState(initial)
  React.useEffect(() => setSections(initial), [initial])

  const [active, setActive] = React.useState<PlanTicket | null>(null)
  const [editing, setEditing] = React.useState<CycleFormValue | null>(null)
  const [closing, setClosing] = React.useState<Planning['cycles'][number] | null>(null)
  const [proposal, setProposal] = React.useState<{ cycleId: string; cycleName: string; proposal: ScopeProposal } | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const sectionOf = (ticketId: string) => sections.find((section) => section.tickets.some((ticket) => ticket.id === ticketId))
  const weight = (ticket: PlanTicket) => (planning.unit === 'points' ? (ticket.storyPoints ?? 0) : 1)

  function persist(ticketId: string, destination: string, next: Section[]) {
    const previous = sections
    setSections(next)
    const list = next.find((section) => section.id === destination)!
    void (async () => {
      const result = await arrangeAction({
        ticketId,
        cycleId: destination === BACKLOG ? null : destination,
        orderedIds: list.tickets.map((ticket) => ticket.id),
      })
      if (!result.success) {
        setSections(previous)
        toast.error(result.error)
        return
      }
      router.refresh()
    })()
  }

  function moveTo(ticketId: string, destination: string, index?: number) {
    const from = sectionOf(ticketId)
    if (!from) return
    const ticket = from.tickets.find((entry) => entry.id === ticketId)!
    const next = sections.map((section) => ({ ...section, tickets: section.tickets.filter((entry) => entry.id !== ticketId) }))
    const target = next.find((section) => section.id === destination)!
    const at = index === undefined ? (destination === BACKLOG ? 0 : target.tickets.length) : Math.max(0, Math.min(index, target.tickets.length))
    target.tickets.splice(at, 0, { ...ticket, cycleId: destination === BACKLOG ? null : destination })
    persist(ticketId, destination, next)
  }

  function onDragStart(event: DragStartEvent) {
    const section = sectionOf(String(event.active.id))
    setActive(section?.tickets.find((ticket) => ticket.id === event.active.id) ?? null)
  }

  function onDragEnd(event: DragEndEvent) {
    setActive(null)
    const { active: dragged, over } = event
    if (!over) return
    const ticketId = String(dragged.id)
    const overId = String(over.id)
    const destination = sections.find((section) => section.id === overId) ?? sectionOf(overId)
    if (!destination) return
    const from = sectionOf(ticketId)
    const overIndex = destination.tickets.findIndex((ticket) => ticket.id === overId)
    const currentIndex = destination.tickets.findIndex((ticket) => ticket.id === ticketId)
    if (from?.id === destination.id && (overIndex === currentIndex || overIndex === -1)) return
    moveTo(ticketId, destination.id, overIndex === -1 ? destination.tickets.length : overIndex)
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  const cycles = planning.cycles
  const destinations = [...cycles.map((cycle) => ({ id: cycle.id, name: cycle.name })), { id: BACKLOG, name: 'Backlog' }]

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="space-y-5">
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEditing({ projectId, kind: 'SPRINT' })}>
              <Plus className="size-4" /> New sprint
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing({ projectId, kind: 'MILESTONE' })}>
              <Plus className="size-4" /> New milestone
            </Button>
          </div>
        )}

        {cycles.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <CalendarRange className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">No sprints or milestones yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A sprint is a timebox, one at a time. A milestone is a goal with a date — several can run at once, which suits client work.
            </p>
          </div>
        )}

        {cycles.map((cycle) => {
          const section = sections.find((entry) => entry.id === cycle.id) ?? { id: cycle.id, tickets: [] }
          const load = section.tickets.reduce((sum, ticket) => sum + weight(ticket), 0)
          const done = section.tickets.filter((ticket) => ticket.status.category === 'DONE').reduce((sum, ticket) => sum + weight(ticket), 0)
          const over = cycle.capacity !== null && load > cycle.capacity
          return (
            <SectionCard
              key={cycle.id}
              id={cycle.id}
              tickets={section.tickets}
              canPlan={canPlan}
              destinations={destinations}
              onMove={moveTo}
              unit={planning.unit}
              header={
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{cycle.name}</h2>
                    <Badge variant="outline" className="text-[10px]">
                      {cycle.kind === 'SPRINT' ? 'Sprint' : 'Milestone'}
                    </Badge>
                    {cycle.state === 'ACTIVE' && <Badge className="bg-emerald-600 text-[10px] text-white">Running</Badge>}
                    {(cycle.startDate || cycle.endDate) && (
                      <span className="text-xs text-muted-foreground">
                        {cycle.startDate ? format(cycle.startDate, 'd MMM') : '…'} → {cycle.endDate ? format(cycle.endDate, 'd MMM yyyy') : '…'}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                        <Link href={`/projects/${projectId}/plan/${cycle.id}`}>
                          <BarChart3 className="size-3.5" /> Burn-up
                        </Link>
                      </Button>
                      {canPlan && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={busy !== null}
                            onClick={() =>
                              run(`fill-${cycle.id}`, async () => {
                                const result = await proposeFillAction(cycle.id)
                                if (!result.success) toast.error(result.error)
                                else setProposal({ cycleId: cycle.id, cycleName: cycle.name, proposal: result.data })
                              })
                            }
                          >
                            {busy === `fill-${cycle.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                            Fill to capacity
                          </Button>
                          {plannerAvailable && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={busy !== null}
                              onClick={() =>
                                run(`ask-${cycle.id}`, async () => {
                                  const result = await askPlannerAction(cycle.id)
                                  if (!result.success) toast.error(result.error)
                                  else setProposal({ cycleId: cycle.id, cycleName: cycle.name, proposal: result.data })
                                })
                              }
                            >
                              {busy === `ask-${cycle.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                              Ask the Planner
                            </Button>
                          )}
                        </>
                      )}
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="size-7" aria-label={`${cycle.name} actions`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {cycle.state === 'PLANNED' && (
                              <DropdownMenuItem
                                onSelect={() =>
                                  run(`start-${cycle.id}`, async () => {
                                    const result = await startCycleAction(cycle.id)
                                    if (!result.success) toast.error(result.error)
                                    else {
                                      toast.success(`${cycle.name} started.`)
                                      router.refresh()
                                    }
                                  })
                                }
                              >
                                <Play className="size-4" /> Start
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setClosing(cycle)}>
                              <Square className="size-4" /> Close…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                setEditing({
                                  id: cycle.id,
                                  projectId,
                                  kind: cycle.kind,
                                  name: cycle.name,
                                  goal: cycle.goal,
                                  startDate: cycle.startDate,
                                  endDate: cycle.endDate,
                                  capacity: cycle.capacity,
                                })
                              }
                            >
                              <CalendarRange className="size-4" /> Edit
                            </DropdownMenuItem>
                            {cycle.state !== 'ACTIVE' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() =>
                                    run(`delete-${cycle.id}`, async () => {
                                      if (!window.confirm(`Delete ${cycle.name}? Its tickets return to the backlog.`)) return
                                      const result = await deleteCycleAction(cycle.id)
                                      if (!result.success) toast.error(result.error)
                                      else router.refresh()
                                    })
                                  }
                                >
                                  <Trash2 className="size-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  {cycle.goal && <p className="text-xs text-muted-foreground">Goal: {cycle.goal}</p>}
                  <div className="flex items-center gap-3">
                    <Progress
                      value={cycle.capacity ? Math.min(100, (load / cycle.capacity) * 100) : load ? (done / load) * 100 : 0}
                      className={cn('h-1.5 flex-1', over && '[&>div]:bg-destructive')}
                      aria-label={cycle.capacity ? `${load} of ${cycle.capacity} ${planning.unit} planned` : `${done} of ${load} ${planning.unit} done`}
                    />
                    <span className={cn('shrink-0 text-xs tabular-nums', over ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {cycle.capacity ? `${load} / ${cycle.capacity} ${planning.unit}` : `${load} ${planning.unit}`} · {done} done
                    </span>
                  </div>
                </div>
              }
            />
          )
        })}

        <SectionCard
          id={BACKLOG}
          tickets={sections.find((section) => section.id === BACKLOG)?.tickets ?? []}
          canPlan={canPlan}
          destinations={destinations}
          onMove={moveTo}
          unit={planning.unit}
          header={
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Backlog</h2>
              <span className="text-xs text-muted-foreground">
                {sections.find((section) => section.id === BACKLOG)?.tickets.length ?? 0} open tickets not planned · drag to rank, top first
              </span>
            </div>
          }
        />

        {planning.closed.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Closed</h2>
            <ul className="divide-y rounded-xl border text-sm">
              {planning.closed.map((cycle) => {
                const summary = (cycle.summary ?? {}) as { completed?: number; carried?: number; carriedTo?: string }
                return (
                  <li key={cycle.id} className="flex flex-wrap items-center gap-2 p-2.5">
                    <Link href={`/projects/${projectId}/plan/${cycle.id}`} className="font-medium hover:underline">
                      {cycle.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      closed {cycle.closedAt ? format(cycle.closedAt, 'd MMM yyyy') : ''} · {summary.completed ?? 0} done
                      {summary.carried ? ` · ${summary.carried} carried to ${summary.carriedTo}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>

      <DragOverlay>{active ? <Row ticket={active} unit={planning.unit} dragging /> : null}</DragOverlay>

      <CycleDialog value={editing} onClose={() => setEditing(null)} unit={planning.unit} />
      <CloseCycleDialog
        cycle={closing}
        others={cycles.filter((cycle) => cycle.id !== closing?.id).map((cycle) => ({ id: cycle.id, name: cycle.name }))}
        unfinished={closing ? (sections.find((section) => section.id === closing.id)?.tickets ?? []).filter((ticket) => !['DONE', 'CANCELLED'].includes(ticket.status.category)).length : 0}
        onClose={() => setClosing(null)}
      />
      <ProposalDialog
        value={proposal}
        tickets={sections.find((section) => section.id === BACKLOG)?.tickets ?? []}
        onClose={() => setProposal(null)}
        onApply={async (cycleId, keys) => {
          const result = await applyScopeAction({ cycleId, keys })
          if (!result.success) {
            toast.error(result.error)
            return false
          }
          toast.success(`Planned ${result.data.moved} ${result.data.moved === 1 ? 'ticket' : 'tickets'}.`)
          router.refresh()
          return true
        }}
      />
    </DndContext>
  )
}

function SectionCard({
  id,
  header,
  tickets,
  canPlan,
  destinations,
  onMove,
  unit,
}: {
  id: string
  header: React.ReactNode
  tickets: PlanTicket[]
  canPlan: boolean
  destinations: Array<{ id: string; name: string }>
  onMove: (ticketId: string, destination: string, index?: number) => void
  unit: 'points' | 'tickets'
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section className={cn('rounded-xl border bg-card', isOver && 'ring-2 ring-primary/30')}>
      <div className="border-b p-3">{header}</div>
      <div ref={setNodeRef} className="min-h-12 p-1.5">
        <SortableContext items={tickets.map((ticket) => ticket.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {tickets.map((ticket, index) => (
              <SortableRow
                key={ticket.id}
                ticket={ticket}
                unit={unit}
                canPlan={canPlan}
                index={index}
                count={tickets.length}
                sectionId={id}
                destinations={destinations}
                onMove={onMove}
              />
            ))}
          </ul>
        </SortableContext>
        {tickets.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {id === BACKLOG ? 'Nothing waiting — everything open is planned.' : 'Drag tickets here from the backlog.'}
          </p>
        )}
      </div>
    </section>
  )
}

function SortableRow({
  ticket,
  unit,
  canPlan,
  index,
  count,
  sectionId,
  destinations,
  onMove,
}: {
  ticket: PlanTicket
  unit: 'points' | 'tickets'
  canPlan: boolean
  index: number
  count: number
  sectionId: string
  destinations: Array<{ id: string; name: string }>
  onMove: (ticketId: string, destination: string, index?: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id, disabled: !canPlan })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'opacity-40')}>
      <Row
        ticket={ticket}
        unit={unit}
        handle={
          canPlan ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
              aria-label={`Drag ${ticket.key}`}
            >
              <GripVertical className="size-3.5" />
            </button>
          ) : null
        }
        menu={
          canPlan ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-6" aria-label={`Plan ${ticket.key}`}>
                  <ArrowRightLeft className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Move {ticket.key}</DropdownMenuLabel>
                <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(ticket.id, sectionId, 0)}>
                  To the top
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(ticket.id, sectionId, index - 1)}>
                  Up one
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(ticket.id, sectionId, index + 1)}>
                  Down one
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {destinations
                  .filter((destination) => destination.id !== sectionId)
                  .map((destination) => (
                    <DropdownMenuItem key={destination.id} onSelect={() => onMove(ticket.id, destination.id)}>
                      Into {destination.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
    </li>
  )
}

function Row({
  ticket,
  unit,
  handle,
  menu,
  dragging,
}: {
  ticket: PlanTicket
  unit: 'points' | 'tickets'
  handle?: React.ReactNode
  menu?: React.ReactNode
  dragging?: boolean
}) {
  const finished = ticket.status.category === 'DONE' || ticket.status.category === 'CANCELLED'
  return (
    <div className={cn('flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent/40', dragging && 'border bg-card shadow-lg')}>
      {handle}
      <span className={cn('size-2 shrink-0 rounded-full', colorClasses(ticket.type.color).dot)} title={ticket.type.name} aria-hidden />
      <Link href={`/tickets/${ticket.key}`} className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline">
        {ticket.key}
      </Link>
      <span className={cn('min-w-0 flex-1 truncate', finished && 'text-muted-foreground line-through')}>{ticket.title}</span>
      {ticket.blockedBy.length > 0 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-destructive" title={`Blocked by ${ticket.blockedBy.join(', ')}`}>
          <Ban className="size-3" aria-hidden /> {ticket.blockedBy[0]}
          <span className="sr-only">blocked by {ticket.blockedBy.join(', ')}</span>
        </span>
      )}
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{ticket.status.name}</span>
      <PriorityBadge name={ticket.priority.name} color={ticket.priority.color} level={ticket.priority.level} showLabel={false} />
      <span
        className={cn('w-8 shrink-0 text-right text-[11px] tabular-nums', ticket.storyPoints ? 'text-foreground' : 'text-muted-foreground')}
        title={unit === 'points' ? (ticket.storyPoints ? `${ticket.storyPoints} story points` : 'Not pointed') : undefined}
      >
        {ticket.storyPoints ?? '–'}
      </span>
      {ticket.assignee ? (
        <UserAvatar userId={ticket.assignee.id} name={ticket.assignee.name} color={ticket.assignee.avatarColor} size="xs" />
      ) : (
        <span className="size-5 shrink-0 rounded-full border border-dashed" title="Unassigned" />
      )}
      {menu}
    </div>
  )
}
