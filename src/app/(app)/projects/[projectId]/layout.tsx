import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Archive, BookOpen } from 'lucide-react'
import { prisma } from '@/infrastructure/db/prisma'
import { LiveRefresher } from '@/features/live/live-refresher'

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
  const { actor } = await requireProjectViewPage(projectId)

  const project = await getProjectDetail(projectId)
  if (!project) notFound()

  const color = project.settings?.color ?? 'indigo'

  // Someone who joined in the last month and has not opened the latest
  // handbook is pointed at it until they do.
  const joined = project.members.find((member) => member.user.id === actor.id)?.joinedAt
  const [handbook, read] =
    joined && Date.now() - joined.getTime() < 30 * 86_400_000
      ? await Promise.all([
          prisma.projectDocument.findFirst({ where: { projectId, kind: 'HANDBOOK' }, orderBy: { version: 'desc' }, select: { version: true } }),
          prisma.projectDocumentRead.findUnique({ where: { userId_projectId_kind: { userId: actor.id, projectId, kind: 'HANDBOOK' } }, select: { version: true } }),
        ])
      : [null, null]
  const showHandbook = Boolean(handbook && (!read || read.version < handbook.version))

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
                  userId={member.user.id}
                  name={member.user.name}
                  color={member.user.avatarColor}
                  size="sm"
                  // Overlapping faces are separated by a background ring, which
                  // would paint over the role rim.
                  ring={false}
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
        {showHandbook && (
          <p className="flex flex-wrap items-center gap-2 border-t bg-primary/5 px-4 py-2 text-sm sm:px-6">
            <BookOpen className="size-4 text-primary" aria-hidden />
            New to {project.name}?
            <Link href={`/projects/${projectId}/handbook`} className="font-medium text-primary hover:underline">
              Read the handbook — it takes about ten minutes.
            </Link>
          </p>
        )}
      </div>

      <LiveRefresher projectId={projectId} enabled={project.settings?.liveUpdates ?? false} />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
