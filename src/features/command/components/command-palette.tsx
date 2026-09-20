'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FolderKanban,
  FolderPlus,
  LayoutDashboard,
  ListTodo,
  Loader2,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Ticket,
  UserX,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { ColorDot, StatusBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { updateTicketAction } from '@/features/tickets/actions'
import {
  getTicketQuickActionsAction,
  paletteSearchAction,
  type PaletteResults,
  type PaletteTicket,
  type TicketQuickActions,
} from '../actions'

/**
 * Command palette (⌘K / Ctrl+K).
 *
 * Search runs on the server because the workspace can hold far more tickets
 * than are sensible to ship to the browser; results are debounced and the
 * in-flight request is tracked so a slow response cannot overwrite a newer one.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onCreateTicket,
  onOpenCopilot,
  canCreateProject,
  canAdministerWorkspace,
  onOpenCapture,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateTicket: () => void
  onOpenCopilot: () => void
  canCreateProject: boolean
  canAdministerWorkspace: boolean
  onOpenCapture: () => void
}) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<PaletteResults>({ tickets: [], projects: [] })
  const [isLoading, setIsLoading] = React.useState(false)

  /*
   * The palette has a second level. Selecting a ticket with → (or Tab) opens
   * its actions — assign, change status — without leaving the keyboard, which
   * is the whole point of a palette. `page` is null at the root.
   */
  const [page, setPage] = React.useState<'ticket' | null>(null)
  const [actions, setActions] = React.useState<TicketQuickActions | null>(null)
  const [isActing, setIsActing] = React.useState(false)

  // Guards against an earlier, slower response landing after a newer one.
  const requestId = React.useRef(0)

  React.useEffect(() => {
    if (!open || page === 'ticket') return

    const id = ++requestId.current
    setIsLoading(true)

    const timer = setTimeout(async () => {
      const result = await paletteSearchAction(query)
      if (id !== requestId.current) return

      if (result.success) setResults(result.data)
      setIsLoading(false)
    }, 180)

    return () => clearTimeout(timer)
  }, [query, open, page])

  // Reset to the root whenever the palette closes.
  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setPage(null)
      setActions(null)
    }
  }, [open])

  async function openTicketActions(ticket: PaletteTicket) {
    setIsActing(true)
    const result = await getTicketQuickActionsAction(ticket.id)
    setIsActing(false)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    setActions(result.data)
    setPage('ticket')
    setQuery('')
  }

  function backToRoot() {
    setPage(null)
    setActions(null)
    setQuery('')
  }

  function applyTicketChange(
    change: Parameters<typeof updateTicketAction>[0],
    message: string,
  ) {
    setIsActing(true)
    void (async () => {
      const result = await updateTicketAction(change)
      setIsActing(false)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(message)
      onOpenChange(false)
      router.refresh()
    })()
  }

  function run(action: () => void) {
    onOpenChange(false)
    // Let the dialog close before navigating, so the exit animation is not cut.
    setTimeout(action, 0)
  }

  // --- ticket action sub-view ------------------------------------------------
  if (page === 'ticket' && actions) {
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Actions for ${actions.ticket.key}`}
        description="Assign or change status without leaving the keyboard"
        className="sm:max-w-xl"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button
            type="button"
            onClick={backToRoot}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Back
          </button>
          <span className="font-mono text-xs text-muted-foreground">
            {actions.ticket.key}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{actions.ticket.title}</span>
          {isActing && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
        </div>

        <CommandInput
          placeholder="Filter actions…"
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            // Backspace on an empty filter steps back, the way a nested palette
            // is expected to behave.
            if (event.key === 'Backspace' && query === '') {
              event.preventDefault()
              backToRoot()
            }
            if (event.key === 'ArrowLeft' && query === '') {
              event.preventDefault()
              backToRoot()
            }
          }}
        />

        <CommandList className="max-h-[420px]">
          <CommandEmpty>No matching action.</CommandEmpty>

          {!actions.canEdit && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              You have read-only access to this project.
            </div>
          )}

          {actions.canEdit && (
            <>
              <CommandGroup heading="Change status">
                {actions.statuses.map((status) => (
                  <CommandItem
                    key={status.id}
                    value={`status ${status.name}`}
                    disabled={isActing}
                    onSelect={() => {
                      if (status.isCurrent) return
                      applyTicketChange(
                        { id: actions.ticket.id, statusId: status.id },
                        `${actions.ticket.key} moved to ${status.name}.`,
                      )
                    }}
                  >
                    <ColorDot color={status.color} />
                    <span className="flex-1 truncate">{status.name}</span>
                    {status.isCurrent && <Check className="size-4 opacity-60" />}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Assign to">
                <CommandItem
                  value="assign unassigned"
                  disabled={isActing}
                  onSelect={() =>
                    applyTicketChange(
                      { id: actions.ticket.id, assigneeId: null },
                      `${actions.ticket.key} unassigned.`,
                    )
                  }
                >
                  <UserX className="size-4 text-muted-foreground" />
                  <span className="flex-1">Unassigned</span>
                </CommandItem>

                {actions.members.map((member) => (
                  <CommandItem
                    key={member.id}
                    value={`assign ${member.name} ${member.username}`}
                    disabled={isActing}
                    onSelect={() => {
                      if (member.isCurrent) return
                      applyTicketChange(
                        { id: actions.ticket.id, assigneeId: member.id },
                        `${actions.ticket.key} assigned to ${member.name}.`,
                      )
                    }}
                  >
                    <UserAvatar name={member.name} color={member.avatarColor} size="xs" />
                    <span className="flex-1 truncate">
                      {member.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        @{member.username}
                      </span>
                    </span>
                    {member.isCurrent && <Check className="size-4 opacity-60" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />

          <CommandGroup heading="Open">
            <CommandItem
              value="open ticket"
              onSelect={() => run(() => router.push(`/tickets/${actions.ticket.key}`))}
            >
              <Ticket className="size-4" />
              Open {actions.ticket.key}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    )
  }

  // --- root view -------------------------------------------------------------
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search tickets and projects, or run a command"
      shouldFilter={false}
      className="sm:max-w-xl"
    >
      <CommandInput
        placeholder="Search tickets, projects, or type a command…"
        value={query}
        onValueChange={setQuery}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'Tab') return

          // ArrowRight must still move the caret when the user is mid-word.
          const input = event.currentTarget
          if (
            event.key === 'ArrowRight' &&
            input.selectionStart !== null &&
            input.selectionStart < input.value.length
          ) {
            return
          }

          // cmdk marks the highlighted row with aria-selected.
          const selected = document.querySelector<HTMLElement>(
            '[cmdk-item][aria-selected="true"]',
          )
          const value = selected?.getAttribute('data-value') ?? ''
          if (!value.startsWith('ticket-')) return

          const ticket = results.tickets.find(
            (candidate) => `ticket-${candidate.id}` === value,
          )
          if (!ticket) return

          event.preventDefault()
          void openTicketActions(ticket)
        }}
      />

      <CommandList className="max-h-[420px]">
        {isLoading && results.tickets.length === 0 && results.projects.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Searching…
          </div>
        ) : (
          <CommandEmpty>No results for “{query}”.</CommandEmpty>
        )}

        {results.tickets.length > 0 && (
          <CommandGroup heading="Tickets · → for actions">
            {results.tickets.map((ticket) => (
              <CommandItem
                key={ticket.id}
                value={`ticket-${ticket.id}`}
                onSelect={() => run(() => router.push(`/tickets/${ticket.key}`))}
              >
                <Ticket className="size-4 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {ticket.key}
                </span>
                <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                <StatusBadge name={ticket.statusName} color={ticket.statusColor} />
                <button
                  type="button"
                  aria-label={`Actions for ${ticket.key}`}
                  className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-aria-selected:opacity-100"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void openTicketActions(ticket)
                  }}
                >
                  <ArrowRight className="size-3.5" />
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.projects.length > 0 && (
          <CommandGroup heading="Projects">
            {results.projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`project-${project.id}`}
                onSelect={() => run(() => router.push(`/projects/${project.id}/board`))}
              >
                <span
                  className={cn('size-3 shrink-0 rounded-sm', colorClasses(project.color).dot)}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {project.code}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Create">
          <CommandItem value="create-ticket" onSelect={() => run(onCreateTicket)}>
            <Plus className="size-4" />
            New ticket
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          {canCreateProject && (
            <CommandItem
              value="create-project"
              onSelect={() => run(() => router.push('/projects/new'))}
            >
              <FolderPlus className="size-4" />
              New project
            </CommandItem>
          )}
          <CommandItem value="open-copilot" onSelect={() => run(onOpenCopilot)}>
            <Sparkles className="size-4" />
            Ask the Copilot
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
          <CommandItem value="capture-notes" onSelect={() => run(onOpenCapture)}>
            <Wand2 className="size-4" />
            Capture notes as tickets
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Go to">
          <CommandItem value="goto-dashboard" onSelect={() => run(() => router.push('/dashboard'))}>
            <LayoutDashboard className="size-4" />
            Dashboard
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem value="goto-my-tickets" onSelect={() => run(() => router.push('/my-tickets'))}>
            <ListTodo className="size-4" />
            My Tickets
            <CommandShortcut>G T</CommandShortcut>
          </CommandItem>
          <CommandItem value="goto-projects" onSelect={() => run(() => router.push('/projects'))}>
            <FolderKanban className="size-4" />
            Projects
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem value="goto-activity" onSelect={() => run(() => router.push('/activity'))}>
            <Activity className="size-4" />
            Activity
          </CommandItem>
          {canAdministerWorkspace && (
            <CommandItem
              value="goto-workspace"
              onSelect={() => run(() => router.push('/workspace'))}
            >
              <Building2 className="size-4" />
              Workspace
            </CommandItem>
          )}
          <CommandItem value="goto-settings" onSelect={() => run(() => router.push('/settings'))}>
            <Settings className="size-4" />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Appearance">
          <CommandItem value="theme-light" onSelect={() => run(() => setTheme('light'))}>
            <Sun className="size-4" />
            Light theme
          </CommandItem>
          <CommandItem value="theme-dark" onSelect={() => run(() => setTheme('dark'))}>
            <Moon className="size-4" />
            Dark theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
