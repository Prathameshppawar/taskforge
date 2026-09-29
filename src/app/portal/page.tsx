import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { getPortal } from '@/features/portal/queries'
import { NewRequest } from '@/features/portal/components/new-request'
import { ApproveButton } from '@/features/portal/components/approve-button'
import { canInProject } from '@/core/domain/rbac'
import { getProjectAccess } from '@/features/auth/guards'
import { prisma } from '@/infrastructure/db/prisma'
import { forecastCycle } from '@/features/forecast/queries'
import { ForecastLine } from '@/features/forecast/components/forecast-line'

export const metadata: Metadata = { title: 'Client portal' }
export const dynamic = 'force-dynamic'

export default async function PortalPage() {
  const actor = await requireUser()
  const portal = await getPortal(actor)

  if (portal.length === 0) {
    return <p className="text-sm text-muted-foreground">You have not been added to a project yet. Ask your contact to add you.</p>
  }

  return (
    <div className="space-y-10">
      {await Promise.all(
        portal.map(async ({ project, requests, awaiting, shipped }) => {
          const access = await getProjectAccess(project.id, actor)
          const canRequest = canInProject(access, 'ticket:create')
          const canApprove = canInProject(access, 'ticket:approve')
          return (
            <section key={project.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold">{project.name}</h1>
                <Link href={`/portal/report?project=${project.id}`} className="text-xs text-primary hover:underline">
                  Monthly report
                </Link>
              </div>

              {canRequest && <NewRequest projectId={project.id} />}

              <Milestones projectId={project.id} />

              <div className="space-y-2">
                <h2 className="text-sm font-semibold">Waiting for your approval</h2>
                {awaiting.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing is waiting on you.</p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {awaiting.map((ticket) => {
                      const preview = ticket.deployments[0]?.deployment
                      return (
                        <li key={ticket.key} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                          <Link href={`/portal/tickets/${ticket.key}`} className="min-w-0 flex-1 hover:underline">
                            <span className="mr-2 font-mono text-xs text-muted-foreground">{ticket.key}</span>
                            {ticket.title}
                          </Link>
                          {preview?.url && (
                            <a href={preview.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              Try the preview <ExternalLink className="size-3" />
                            </a>
                          )}
                          {canApprove && <ApproveButton ticketKey={ticket.key} />}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">Your requests</h2>
                  {requests.length === 0 ? (
                    <p className="text-xs text-muted-foreground">You have not filed anything yet.</p>
                  ) : (
                    <ul className="divide-y rounded-xl border text-sm">
                      {requests.map((ticket) => (
                        <li key={ticket.key} className="flex items-center gap-2 p-2.5">
                          <Link href={`/portal/tickets/${ticket.key}`} className="min-w-0 flex-1 truncate hover:underline">
                            {ticket.title}
                          </Link>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px]">{ticket.status.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">Shipped in the last 30 days</h2>
                  {shipped.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing has gone live yet this month.</p>
                  ) : (
                    <ul className="divide-y rounded-xl border text-sm">
                      {shipped.map((entry) => (
                        <li key={`${entry.ticket.key}-${entry.deployment.createdAt.toISOString()}`} className="flex items-center gap-2 p-2.5">
                          <span className="min-w-0 flex-1 truncate">{entry.ticket.title}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{entry.deployment.createdAt.toISOString().slice(0, 10)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )
        }),
      )}
    </div>
  )
}

/**
 * Open milestones and running sprints, with when they are likely to land — the
 * question a client asks most, answered from the team's real pace rather than
 * a promise.
 */
async function Milestones({ projectId }: { projectId: string }) {
  const cycles = await prisma.cycle.findMany({
    where: { projectId, state: { not: 'CLOSED' }, OR: [{ kind: 'MILESTONE' }, { state: 'ACTIVE' }] },
    orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }],
    select: { id: true, name: true, goal: true, endDate: true, kind: true },
    take: 5,
  })
  if (cycles.length === 0) return null
  const forecasts = await Promise.all(cycles.map((cycle) => forecastCycle(cycle.id)))
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">Coming up</h2>
      <ul className="divide-y rounded-xl border">
        {cycles.map((cycle, index) => (
          <li key={cycle.id} className="space-y-1 p-3">
            <p className="text-sm font-medium">
              {cycle.name}
              {cycle.goal && <span className="font-normal text-muted-foreground"> — {cycle.goal}</span>}
            </p>
            <ForecastLine forecast={forecasts[index]} dueDate={cycle.endDate} />
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">Forecasts replay the team’s pace over the last eight weeks, thousands of times. They move as work finishes.</p>
    </div>
  )
}
