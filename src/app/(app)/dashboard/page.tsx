import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, FolderKanban } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import {
  getCompletionRate,
  getLabelDistribution,
  getPriorityDistribution,
  getProjectSummaries,
  getStatCounts,
  getTeamWorkload,
  getTicketTrend,
} from '@/features/dashboard/queries'
import { getWorkspaceActivity } from '@/features/activity/queries'
import { StatTiles, CompletionCard } from '@/features/dashboard/components/stat-tiles'
import {
  LabelChart,
  PriorityChart,
  TicketTrendChart,
  WorkloadChart,
} from '@/features/dashboard/components/charts'
import { ActivityFeed } from '@/features/activity/components/activity-feed'
import { PageHeader, EmptyState } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ProjectLogo } from '@/components/shared/project-logo'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const actor = await requireUser()

  const [
    workspaceStats,
    myStats,
    completion,
    trend,
    priorities,
    labels,
    workload,
    projects,
    activity,
  ] = await Promise.all([
    getStatCounts(actor),
    getStatCounts(actor, { assigneeId: actor.id }),
    getCompletionRate(actor),
    getTicketTrend(actor, {}, 30),
    getPriorityDistribution(actor),
    getLabelDistribution(actor),
    getTeamWorkload(actor),
    getProjectSummaries(actor),
    getWorkspaceActivity(actor, 12),
  ])

  const firstName = actor.name.split(' ')[0]

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Your workspace at a glance."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/my-tickets">
              My tickets
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        {/* Personal summary */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Assigned to you</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Assigned" value={myStats.total} href="/my-tickets" />
            <MiniStat
              label="Pending"
              value={myStats.open + myStats.inProgress}
              href="/my-tickets?category=BACKLOG,TODO,IN_PROGRESS,REVIEW"
            />
            <MiniStat label="Completed" value={myStats.done} href="/my-tickets?category=DONE" />
            <MiniStat
              label="Overdue"
              value={myStats.overdue}
              href="/my-tickets?overdue=1"
              emphasis={myStats.overdue > 0}
            />
          </div>
        </section>

        {/* Workspace summary */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Across all projects</h2>
          <StatTiles stats={workspaceStats} basePath="/my-tickets" />
        </section>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <CompletionCard
            percent={completion.percent}
            completed={completion.completed}
            countable={completion.countable}
          />
          <TicketTrendChart data={trend} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PriorityChart data={priorities} />
          <LabelChart data={labels} />
        </div>

        <WorkloadChart data={workload} />

        {/* Projects */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Projects</h2>
            <Button asChild variant="ghost" size="sm" className="h-7">
              <Link href="/projects">View all</Link>
            </Button>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create a project to start tracking work."
              action={
                <Button asChild size="sm">
                  <Link href="/projects/new">New project</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}/insights`}
                  className="rounded-xl border bg-card p-3 transition-all hover:border-foreground/20 hover:shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <ProjectLogo
                      name={project.name}
                      color={project.color}
                      logoUrl={project.logoUrl}
                      size="sm"
                    />
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {project.code}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Progress value={project.percent} className="h-1.5" />
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {project.percent}%
                    </span>
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {project.done}/{project.total} done
                    {project.overdue > 0 && (
                      <span className="ml-2 text-destructive">{project.overdue} overdue</span>
                    )}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Activity */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Button asChild variant="ghost" size="sm" className="h-7">
              <Link href="/activity">View all</Link>
            </Button>
          </div>
          <div className="rounded-xl border bg-card p-2">
            <ActivityFeed items={activity} showTicket />
          </div>
        </section>
      </div>
    </div>
  )
}

function MiniStat({
  label,
  value,
  href,
  emphasis,
}: {
  label: string
  value: number
  href: string
  emphasis?: boolean
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border bg-card p-3 transition-all hover:border-foreground/20 hover:shadow-sm"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          emphasis && 'text-destructive',
        )}
      >
        {value}
      </p>
    </Link>
  )
}
