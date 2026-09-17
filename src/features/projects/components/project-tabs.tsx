'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  CalendarDays,
  GanttChartSquare,
  LayoutGrid,
  ListTree,
  PieChart,
  Settings,
  Table2,
  Tags,
  Users,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

const TABS = [
  { segment: 'board', label: 'Board', icon: LayoutGrid },
  { segment: 'table', label: 'Table', icon: Table2 },
  { segment: 'tree', label: 'Tree', icon: ListTree },
  { segment: 'calendar', label: 'Calendar', icon: CalendarDays },
  { segment: 'timeline', label: 'Timeline', icon: GanttChartSquare },
  { segment: 'insights', label: 'Insights', icon: PieChart },
  { segment: 'labels', label: 'Labels', icon: Tags },
  { segment: 'members', label: 'Members', icon: Users },
  { segment: 'activity', label: 'Activity', icon: Activity },
  { segment: 'settings', label: 'Settings', icon: Settings },
] as const

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/projects/${projectId}`

  return (
    <ScrollArea className="w-full">
      <nav className="flex items-center gap-0.5 px-4 sm:px-6" aria-label="Project views">
        {TABS.map((tab) => {
          const href = `${base}/${tab.segment}`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          const Icon = tab.icon

          return (
            <Link
              key={tab.segment}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {tab.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </Link>
          )
        })}
      </nav>
      <ScrollBar orientation="horizontal" className="invisible" />
    </ScrollArea>
  )
}
