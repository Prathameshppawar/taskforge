'use client'

import * as React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { RoleKey } from '@prisma/client'
import { Command, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandPalette } from '@/features/command/components/command-palette'
import { CopilotPanel } from '@/features/ai/components/copilot-panel'
import { roleHas } from '@/core/domain/rbac'

interface ShellContextValue {
  openPalette: () => void
  openCopilot: () => void
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
  role,
  aiEnabled,
  children,
}: {
  role: RoleKey
  aiEnabled: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [copilotOpen, setCopilotOpen] = React.useState(false)

  // The Copilot needs to know which project the user is looking at, so it can
  // resolve "create a ticket" without being told the project every time.
  const projectId = React.useMemo(() => {
    const match = /^\/projects\/([^/]+)/.exec(pathname)
    const id = match?.[1]
    return id && id !== 'new' ? id : undefined
  }, [pathname])

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
  }, [router])

  const value = React.useMemo<ShellContextValue>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openCopilot: () => setCopilotOpen(true),
    }),
    [],
  )

  return (
    <ShellContext.Provider value={value}>
      {children}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        canCreateProject={roleHas(role, 'project:create')}
        onCreateTicket={() => {
          // Ticket creation needs a project context, so send the user to one.
          if (projectId) router.push(`/projects/${projectId}/board?new=1`)
          else router.push('/projects')
        }}
        onOpenCopilot={() => setCopilotOpen(true)}
      />

      <CopilotPanel
        open={copilotOpen}
        onOpenChange={setCopilotOpen}
        projectId={projectId}
        enabled={aiEnabled}
      />
    </ShellContext.Provider>
  )
}

/** Toolbar buttons for the palette and the Copilot. */
export function ShellActions({ aiEnabled }: { aiEnabled: boolean }) {
  const { openPalette, openCopilot } = useAppShell()

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
