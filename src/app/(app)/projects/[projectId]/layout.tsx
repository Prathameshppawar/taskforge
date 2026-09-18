import { notFound } from 'next/navigation'
import { Archive } from 'lucide-react'

import { requireProjectViewPage } from '@/features/auth/guards'
import { getProjectDetail } from '@/features/projects/queries'
import { ProjectTabs } from '@/features/projects/components/project-tabs'
import { PROJECT_STATUS_LABELS } from '@/features/projects/components/project-card'
import { UserAvatar } from '@/components/shared/user-avatar'
import { Badge } from '@/components/ui/badge'
import { ProjectLogo } from '@/components/shared/project-logo'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  // Redirects to /forbidden for a project the actor may not see, rather than
  // surfacing a 500 for what is really an access decision.
  await requireProjectViewPage(projectId)

  const project = await getProjectDetail(projectId)
  if (!project) notFound()

  const color = project.settings?.color ?? 'indigo'

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 sm:px-6">
          <ProjectLogo
            name={project.name}
            color={color}
            logoUrl={project.settings?.logoUrl}
            size="lg"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {project.code}
              </span>
              {project.isArchived ? (
                <Badge variant="secondary" className="gap-1">
                  <Archive className="size-3" /> Archived
                </Badge>
              ) : (
                <Badge variant="outline">{PROJECT_STATUS_LABELS[project.status]}</Badge>
              )}
            </div>
            {project.description && (
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {project.members.slice(0, 5).map((member) => (
                <UserAvatar
                  key={member.user.id}
                  name={member.user.name}
                  color={member.user.avatarColor}
                  size="sm"
                  className="ring-2 ring-background"
                />
              ))}
              {project.members.length > 5 && (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
                  +{project.members.length - 5}
                </span>
              )}
            </div>
          </div>
        </div>

        <ProjectTabs projectId={projectId} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
