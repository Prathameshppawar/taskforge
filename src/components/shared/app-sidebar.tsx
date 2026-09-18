'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  ChevronRight,
  FolderKanban,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  LayoutTemplate,
  ListTodo,
  MonitorSmartphone,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import type { RoleKey } from '@prisma/client'

import { cn } from '@/lib/utils'
import { ProjectLogo } from '@/components/shared/project-logo'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { APP_NAME } from '@/lib/env'

export interface SidebarProject {
  id: string
  name: string
  code: string
  color: string
  logoUrl?: string | null
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Roles allowed to see the entry. Omitted = everyone. */
  roles?: RoleKey[]
}

const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/my-tickets', label: 'My Tickets', icon: ListTodo },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/activity', label: 'Activity', icon: Activity },
]

const ADMIN_NAV: NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: Users, roles: ['ADMIN'] },
  { href: '/admin/templates', label: 'Templates', icon: LayoutTemplate, roles: ['ADMIN'] },
  { href: '/admin/sessions', label: 'Sessions', icon: MonitorSmartphone, roles: ['ADMIN'] },
]

export function AppSidebar({
  role,
  projects,
  onNavigate,
}: {
  role: RoleKey
  projects: SidebarProject[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const [projectsOpen, setProjectsOpen] = React.useState(true)

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  const canSeeAdmin = role === 'ADMIN'

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <KanbanSquare className="size-4" />
        </div>
        <span className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      {/*
        min-h-0 is load-bearing: a flex item defaults to min-height:auto, so
        without it this grows to fit the project list instead of scrolling, the
        sidebar becomes taller than the viewport, and the whole PAGE scrolls —
        carrying the board content with it.
      */}
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-6 p-3" aria-label="Main">
          <ul className="space-y-0.5">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(item.href)} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>

          {/* Projects */}
          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
            <div className="flex items-center justify-between px-2">
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                <ChevronRight
                  className={cn(
                    'size-3 transition-transform',
                    projectsOpen && 'rotate-90',
                  )}
                />
                Projects
              </CollapsibleTrigger>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-5 text-muted-foreground"
              >
                <Link href="/projects/new" aria-label="New project" onClick={onNavigate}>
                  <Plus className="size-3.5" />
                </Link>
              </Button>
            </div>

            <CollapsibleContent className="mt-1">
              {projects.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  No projects yet.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {projects.map((project) => {
                    const href = `/projects/${project.id}`
                    return (
                      <li key={project.id}>
                        <Link
                          href={href}
                          onClick={onNavigate}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            isActive(href)
                              ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                              : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                          )}
                        >
                          <ProjectLogo
                            name={project.name}
                            color={project.color}
                            logoUrl={project.logoUrl}
                            size="xs"
                          />
                          <span className="truncate">{project.name}</span>
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                            {project.code}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Administration */}
          {canSeeAdmin && (
            <div>
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                Administration
              </p>
              <ul className="space-y-0.5">
                {ADMIN_NAV.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isActive(item.href)} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3">
        <NavLink
          item={{ href: '/settings', label: 'Settings', icon: Settings }}
          active={isActive('/settings')}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
