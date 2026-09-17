'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
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
} from 'lucide-react'
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
import { StatusBadge } from '@/components/shared/badges'
import { paletteSearchAction, type PaletteResults } from '../actions'

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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateTicket: () => void
  onOpenCopilot: () => void
  canCreateProject: boolean
}) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<PaletteResults>({ tickets: [], projects: [] })
  const [isLoading, setIsLoading] = React.useState(false)

  // Guards against an earlier, slower response landing after a newer one.
  const requestId = React.useRef(0)

  React.useEffect(() => {
    if (!open) return

    const id = ++requestId.current
    setIsLoading(true)

    const timer = setTimeout(async () => {
      const result = await paletteSearchAction(query)
      if (id !== requestId.current) return

      if (result.success) setResults(result.data)
      setIsLoading(false)
    }, 180)

    return () => clearTimeout(timer)
  }, [query, open])

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  function run(action: () => void) {
    onOpenChange(false)
    // Let the dialog close before navigating, so the exit animation is not cut.
    setTimeout(action, 0)
  }

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
          <CommandGroup heading="Tickets">
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
