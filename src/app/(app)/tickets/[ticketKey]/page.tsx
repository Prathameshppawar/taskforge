import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, GitBranch } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { getTicketByKey } from '@/features/tickets/queries'
import { getProjectViewContext } from '@/features/projects/project-context'
import { getTicketActivity } from '@/features/activity/queries'
import { TicketDetailSidebar } from '@/features/tickets/components/ticket-detail-sidebar'
import { EditableTitle, EditableDescription } from '@/features/tickets/components/editable-title'
import { CommentThread } from '@/features/tickets/components/comment-thread'
import { ResourceList } from '@/features/tickets/components/resource-list'
import { ActivityFeed } from '@/features/activity/components/activity-feed'
import { ChildTicketList } from '@/features/tickets/components/child-ticket-list'
import { TicketLinks } from '@/features/tickets/components/ticket-links'
import { HistoricalEstimate } from '@/features/tickets/components/historical-estimate'
import { estimateFromHistory } from '@/features/tickets/estimates'
import { TicketAttachments } from '@/features/tickets/components/ticket-attachments'
import { WatchButton } from '@/features/tickets/components/watch-button'
import { listTicketLinks } from '@/features/tickets/relations'
import { listAttachments } from '@/features/attachments/actions'
import { prisma } from '@/infrastructure/db/prisma'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { UserAvatar } from '@/components/shared/user-avatar'
import { TypeBadge } from '@/components/shared/badges'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticketKey: string }>
}): Promise<Metadata> {
  const { ticketKey } = await params
  return { title: ticketKey.toUpperCase() }
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketKey: string }>
}) {
  const { ticketKey } = await params
  const actor = await requireUser()

  const ticket = await getTicketByKey(actor, ticketKey)
  if (!ticket) notFound()

  const context = await getProjectViewContext(ticket.project.id)

  const [activity, links, attachments, watchers, estimate] = await Promise.all([
    getTicketActivity(ticket.id),
    listTicketLinks(ticket.id),
    listAttachments(ticket.id),
    prisma.ticketWatcher.findMany({
      where: { ticketId: ticket.id },
      select: { userId: true },
    }),
    // Null whenever the project has not finished enough comparable work, in
    // which case the block simply does not render.
    estimateFromHistory(
      ticket.project.id,
      `${ticket.title}\n\n${ticket.description ?? ''}`,
      ticket.id,
    ).catch(() => null),
  ])

  const canEdit = context.can.updateTicket

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {/* Breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          Projects
        </Link>
        <ChevronRight className="size-3" />
        <Link href={`/projects/${ticket.project.id}/board`} className="hover:text-foreground">
          {ticket.project.name}
        </Link>
        {ticket.parent && (
          <>
            <ChevronRight className="size-3" />
            <Link href={`/tickets/${ticket.parent.key}`} className="hover:text-foreground">
              {ticket.parent.key}
            </Link>
          </>
        )}
        <ChevronRight className="size-3" />
        <span className="font-mono text-foreground">{ticket.key}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{ticket.key}</span>
              <TypeBadge name={ticket.type.name} color={ticket.type.color} />
              {ticket.parent && (
                <Link
                  href={`/tickets/${ticket.parent.key}`}
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <GitBranch className="size-3" />
                  child of {ticket.parent.key}
                </Link>
              )}

              {/* Following is available to anyone who can see the ticket, so it
                  sits with the identity row rather than the edit controls. */}
              <div className="ml-auto">
                <WatchButton
                  ticketId={ticket.id}
                  watching={watchers.some((watcher) => watcher.userId === actor.id)}
                  watcherCount={watchers.length}
                />
              </div>
            </div>

            <EditableTitle
              ticketId={ticket.id}
              value={ticket.title}
              canEdit={canEdit}
              updatedAt={ticket.updatedAt}
            />

            <p className="text-xs text-muted-foreground">
              Reported by {ticket.reporter?.name ?? 'unknown'} ·{' '}
              {ticket.createdAt.toLocaleDateString()} · updated{' '}
              {ticket.updatedAt.toLocaleDateString()}
            </p>
          </div>

          {/* Rollup */}
          {ticket.progress && ticket.progress.total > 0 && (
            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Child ticket progress</span>
                <span className="text-muted-foreground tabular-nums">
                  {ticket.progress.completed} of {ticket.progress.total} done ·{' '}
                  {ticket.progress.completionPercent}%
                </span>
              </div>
              <Progress value={ticket.progress.completionPercent} className="mt-2 h-2" />
              {ticket.progress.blocked > 0 && (
                <p className="mt-1.5 text-[11px] text-destructive">
                  {ticket.progress.blocked} child{' '}
                  {ticket.progress.blocked === 1 ? 'ticket is' : 'tickets are'} blocked
                </p>
              )}
            </div>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Description</h2>
            <EditableDescription
              ticketId={ticket.id}
              value={ticket.description}
              canEdit={canEdit}
              updatedAt={ticket.updatedAt}
            />
          </section>

          {(ticket.remarks || canEdit) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Remarks</h2>
              <EditableDescription
                ticketId={ticket.id}
                value={ticket.remarks}
                canEdit={canEdit}
                updatedAt={ticket.updatedAt}
                field="remarks"
                placeholder="Operational notes, context for whoever picks this up next…"
              />
            </section>
          )}

          <ChildTicketList
            parentId={ticket.id}
            parentKey={ticket.key}
            childTickets={ticket.children}
            canEdit={canEdit && !ticket.parentId}
            isChild={Boolean(ticket.parentId)}
          />

          <HistoricalEstimate estimate={estimate} />

          <TicketLinks ticketKey={ticket.key} links={links} canEdit={canEdit} />

          <TicketAttachments
            ticketId={ticket.id}
            attachments={attachments}
            canEdit={canEdit}
          />

          <ResourceList
            ticketId={ticket.id}
            resources={ticket.resources}
            canEdit={canEdit}
          />

          <Separator />

          <CommentThread
            ticketId={ticket.id}
            comments={ticket.comments}
            currentUserId={actor.id}
            canModerate={context.can.deleteTicket}
            mentionables={context.members.map((m) => ({
              id: m.id,
              name: m.name,
              username: m.username,
            }))}
          />

          <Separator />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">History</h2>
            <ActivityFeed items={activity} emptyMessage="No changes recorded yet." />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 lg:border-l lg:pl-6">
          <TicketDetailSidebar
            ticketId={ticket.id}
            canEdit={canEdit}
            statuses={context.statuses}
            priorities={context.priorities}
            types={context.types}
            labels={context.labels}
            members={context.members}
            current={{
              statusId: ticket.status.id,
              priorityId: ticket.priority.id,
              typeId: ticket.type.id,
              assigneeId: ticket.assignee?.id ?? null,
              labelIds: ticket.labels.map((l) => l.label.id),
              dueDate: ticket.dueDate,
              startDate: ticket.startDate,
            }}
          />

          <Separator />

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Reporter</span>
              {ticket.reporter ? (
                <span className="flex items-center gap-1.5">
                  <UserAvatar
                    name={ticket.reporter.name}
                    color={ticket.reporter.avatarColor}
                    size="xs"
                  />
                  <span className="truncate">{ticket.reporter.name}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>

            {ticket.storyPoints != null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Story points</span>
                <span className="tabular-nums">{ticket.storyPoints}</span>
              </div>
            )}

            {ticket.estimateHours != null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Estimate</span>
                <span className="tabular-nums">{ticket.estimateHours}h</span>
              </div>
            )}

            {ticket.completedAt && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Completed</span>
                <span>{ticket.completedAt.toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
