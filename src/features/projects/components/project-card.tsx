import Link from 'next/link'
import { Archive, CalendarDays, Ticket, Users } from 'lucide-react'
import type { ProjectStatus } from '@prisma/client'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/shared/user-avatar'
import type { ProjectListItem } from '../queries'

const STATUS_STYLES: Record<ProjectStatus, string> = {
  PLANNING: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  ON_HOLD: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  COMPLETED: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',
  ARCHIVED: 'bg-muted text-muted-foreground',
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
}

export function ProjectCard({ project }: { project: ProjectListItem }) {
  const color = project.settings?.color ?? 'indigo'

  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all',
        'hover:border-foreground/20 hover:shadow-md',
        project.isArchived && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn('size-8 shrink-0 rounded-lg', colorClasses(color).dot)}
            aria-hidden
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold group-hover:underline">
              {project.name}
            </h3>
            <p className="font-mono text-[11px] text-muted-foreground">{project.code}</p>
          </div>
        </div>

        {project.isArchived ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Archive className="size-3" /> Archived
          </Badge>
        ) : (
          <span
            className={cn(
              'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium',
              STATUS_STYLES[project.status],
            )}
          >
            {PROJECT_STATUS_LABELS[project.status]}
          </span>
        )}
      </div>

      {project.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Ticket className="size-3.5" />
          {project._count.tickets}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" />
          {project._count.members}
        </span>
        {project.endDate && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {project.endDate.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <UserAvatar name={project.owner.name} color={project.owner.avatarColor} size="xs" />
        </span>
      </div>
    </Link>
  )
}
