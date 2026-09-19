'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  KeyRound,
  LayoutTemplate,
  Lock,
  MonitorSmartphone,
  ShieldCheck,
  User,
  Users,
  UsersRound,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SettingsSection } from '../modules'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  user: User,
  lock: Lock,
  key: KeyRound,
  users: Users,
  shield: ShieldCheck,
  usersRound: UsersRound,
  template: LayoutTemplate,
  monitor: MonitorSmartphone,
}

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname()

  // `/settings` is the profile module, so it must match exactly — a prefix test
  // would mark it active on every other module too.
  const isActive = (href: string) =>
    href === '/settings' ? pathname === '/settings' : pathname.startsWith(href)

  return (
    <>
      {/* Desktop: a column beside the content. */}
      <aside className="hidden w-56 shrink-0 border-r lg:block">
        <ScrollArea className="h-full">
          <nav className="space-y-5 p-3">
            {sections.map((section) => (
              <div key={section.label}>
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.modules.map((module) => {
                    const Icon = ICONS[module.icon] ?? User
                    return (
                      <li key={module.href}>
                        <Link
                          href={module.href}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            isActive(module.href)
                              ? 'bg-accent font-medium text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                          )}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate">{module.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      {/*
        Narrow: the same modules as a horizontal strip. A 56px-wide column on a
        phone would leave nothing for the content it is meant to navigate.
      */}
      <nav className="shrink-0 border-b lg:hidden">
        <ScrollArea className="w-full">
          <ul className="flex gap-1 p-2">
            {sections.flatMap((section) =>
              section.modules.map((module) => {
                const Icon = ICONS[module.icon] ?? User
                return (
                  <li key={module.href} className="shrink-0">
                    <Link
                      href={module.href}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors',
                        isActive(module.href)
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      <Icon className="size-3.5" />
                      {module.label}
                    </Link>
                  </li>
                )
              }),
            )}
          </ul>
        </ScrollArea>
      </nav>
    </>
  )
}
