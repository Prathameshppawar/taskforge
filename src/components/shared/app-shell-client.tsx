'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { Permission } from '@/core/domain/rbac'
import { Command, Sparkles, Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandPalette } from '@/features/command/components/command-palette'
import { CopilotPanel } from '@/features/ai/components/copilot-panel'
import { CaptureDialog } from '@/features/ai/components/capture-dialog'
import type { CopilotScreen } from '@/features/ai/components/copilot-panel'

interface ShellContextValue {
  openPalette: () => void
  openCopilot: () => void
  openCapture: () => void
}

const ShellContext = React.createContext<ShellContextValue | null>(null)

export function useAppShell(): ShellContextValue {
  const context = React.useContext(ShellContext)
  if (!context) throw new Error('useAppShell must be used inside AppShellClient.')
  return context
}

/**
 * Client shell.
 *
 * Owns the command palette, the Copilot drawer and the global keyboard
 * shortcuts. Lives once in the app layout so every page inherits them without
 * mounting its own copy.
 */
export function AppShellClient({
  permissions,
  aiEnabled,
  children,
}: {
  permissions: Permission[]
  aiEnabled: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [paletteOpen, setPaletteOpen] = React.useState(false)

  /*
   * The Copilot's open state is mirrored into sessionStorage.
   *
   * After the Copilot changes data it calls router.refresh() so the board
   * behind it reflects the new tickets. That re-renders this layout from the
   * server, and anything that remounts this component takes the drawer down
   * with it — the panel appeared to close itself the moment a reply landed.
   * Restoring from sessionStorage makes the drawer survive that regardless of
   * what triggers a remount, and sessionStorage rather than localStorage so a
   * new tab does not open with the panel already showing.
   */
  const [copilotOpen, setCopilotOpenState] = React.useState(false)
  const [captureOpen, setCaptureOpen] = React.useState(false)

  React.useEffect(() => {
    try {
      if (window.sessionStorage.getItem('taskforge.copilot.open') === '1') {
        setCopilotOpenState(true)
      }
    } catch {
      // Storage unavailable (private window) — the panel simply starts closed.
    }
  }, [])

  const setCopilotOpen = React.useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setCopilotOpenState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      try {
        window.sessionStorage.setItem('taskforge.copilot.open', value ? '1' : '0')
      } catch {
        // ignored
      }
      return value
    })
  }, [])

  // The Copilot needs to know which project the user is looking at, so it can
  // resolve "create a ticket" without being told the project every time.
  const projectId = React.useMemo(() => {
    const match = /^\/projects\/([^/]+)/.exec(pathname)
    const id = match?.[1]
    return id && id !== 'new' ? id : undefined
  }, [pathname])

  /*
   * What the user is actually looking at.
   *
   * Without this the Copilot knows only which project is open, so "assign this
   * to me" or "how many are there" have no referent — the model cannot see the
   * screen the question is about. Passing the route, the open ticket and any
   * active filters makes those questions answerable.
   */
  const screen = React.useMemo<CopilotScreen>(() => {
    const ticket = /^\/tickets\/([^/]+)/.exec(pathname)?.[1]
    const view = /^\/projects\/[^/]+\/([^/]+)/.exec(pathname)?.[1]

    const filters: string[] = []
    const label = (key: string, name: string) => {
      const value = searchParams.get(key)
      if (value) filters.push(`${name}=${value.split(',').length > 2 ? `${value.split(',').length} selected` : value}`)
    }
    label('q', 'search')
    label('status', 'status')
    label('priority', 'priority')
    label('type', 'type')
    label('label', 'label')
    label('assignee', 'assignee')
    if (searchParams.get('overdue') === '1') filters.push('overdue only')

    return {
      ticketKey: ticket ? ticket.toUpperCase() : undefined,
      view: ticket ? 'ticket' : (view ?? (pathname.split('/')[1] || 'dashboard')),
      filters: filters.length ? filters.join(', ') : undefined,
    }
  }, [pathname, searchParams])

  React.useEffect(() => {
    // `g` followed by a letter is a navigation chord, in the style of Linear
    // and GitHub. The pending flag resets on any other key or after a pause.
    let pendingGoto = false
    let gotoTimer: ReturnType<typeof setTimeout> | undefined

    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.getAttribute('role') === 'combobox'
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey

      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (meta && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setCopilotOpen((open) => !open)
        return
      }

      // Plain-letter shortcuts must never fire while the user is typing.
      if (meta || event.altKey || isTypingTarget(event.target)) return

      if (pendingGoto) {
        pendingGoto = false
        clearTimeout(gotoTimer)

        const routes: Record<string, string> = {
          d: '/dashboard',
          t: '/my-tickets',
          p: '/projects',
          a: '/activity',
          s: '/settings',
        }

        const destination = routes[event.key.toLowerCase()]
        if (destination) {
          event.preventDefault()
          router.push(destination)
        }
        return
      }

      if (event.key.toLowerCase() === 'g') {
        pendingGoto = true
        gotoTimer = setTimeout(() => {
          pendingGoto = false
        }, 1200)
        return
      }

      if (event.key === '?') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(gotoTimer)
    }
    // `setCopilotOpen` is memoised with an empty dependency list, so listing it
    // here documents the dependency without re-binding the listener.
  }, [router, setCopilotOpen])

  const value = React.useMemo<ShellContextValue>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openCopilot: () => setCopilotOpen(true),
      openCapture: () => setCaptureOpen(true),
    }),
    [setCopilotOpen],
  )

  return (
    <ShellContext.Provider value={value}>
      {children}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        canCreateProject={permissions.includes('project:create')}
        onCreateTicket={() => {
          // Ticket creation needs a project context, so send the user to one.
          if (projectId) router.push(`/projects/${projectId}/board?new=1`)
          else router.push('/projects')
        }}
        onOpenCopilot={() => setCopilotOpen(true)}
        onOpenCapture={() => setCaptureOpen(true)}
      />

      <CaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        projectId={projectId}
      />

      <CopilotPanel
        open={copilotOpen}
        onOpenChange={setCopilotOpen}
        projectId={projectId}
        screen={screen}
        enabled={aiEnabled}
      />
    </ShellContext.Provider>
  )
}

/** Toolbar buttons for the palette and the Copilot. */
export function ShellActions({ aiEnabled }: { aiEnabled: boolean }) {
  const { openPalette, openCopilot, openCapture } = useAppShell()

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 text-muted-foreground"
            onClick={openPalette}
          >
            <Command className="size-3.5" />
            <span className="hidden text-xs sm:inline">Search</span>
            <kbd className="ml-1 hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline">
              ⌘K
            </kbd>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Command palette · ⌘K</TooltipContent>
      </Tooltip>

      {/* Capture has its own button rather than living only in the palette:
          typing there searches tickets, so commands are reachable only from an
          empty query — which is no way to find a feature. */}
      {aiEnabled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={openCapture}>
              <Wand2 className="size-4" />
              <span className="sr-only">Capture notes as tickets</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Capture notes as tickets</TooltipContent>
        </Tooltip>
      )}

      {aiEnabled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={openCopilot}>
              <Sparkles className="size-4" />
              <span className="sr-only">Open Copilot</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>AI Copilot · ⌘J</TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
