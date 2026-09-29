import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'

import { requireUser, getProjectAccess } from '@/features/auth/guards'
import { getTicketByKey } from '@/features/tickets/queries'
import { ticketDeployments } from '@/features/github/deployments'
import { canInProject } from '@/core/domain/rbac'
import { ApproveButton } from '@/features/portal/components/approve-button'
import { PortalComment } from '@/features/portal/components/portal-comment'

export async function generateMetadata({ params }: { params: Promise<{ ticketKey: string }> }): Promise<Metadata> {
  return { title: (await params).ticketKey.toUpperCase() }
}

/**
 * One request, as a client sees it: what it is, where it stands, the links to
 * try it, the conversation, and — when it is waiting on them — Approve.
 */
export default async function PortalTicketPage({ params }: { params: Promise<{ ticketKey: string }> }) {
  const { ticketKey } = await params
  const actor = await requireUser()
  const ticket = await getTicketByKey(actor, ticketKey)
  if (!ticket) notFound()

  const [access, deployments] = await Promise.all([getProjectAccess(ticket.project.id, actor), ticketDeployments(ticket.id)])
  const canApprove = canInProject(access, 'ticket:approve') && ticket.status.category === 'REVIEW'
  const canComment = canInProject(access, 'comment:create')
  const links = deployments.filter((deployment) => deployment.state === 'SUCCESS' && deployment.url)

  return (
    <div className="space-y-6">
      <Link href="/portal" className="text-xs text-muted-foreground hover:text-foreground">← All requests</Link>
      <div className="space-y-2">
        <p className="font-mono text-xs text-muted-foreground">{ticket.key} · {ticket.project.name}</p>
        <h1 className="text-xl font-semibold">{ticket.title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-muted px-2 py-0.5 text-xs">{ticket.status.name}</span>
          {canApprove && <ApproveButton ticketKey={ticket.key} />}
        </div>
      </div>

      {links.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {links.map((deployment) => (
            <li key={deployment.id}>
              <a href={deployment.url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                {deployment.isProduction ? 'Open live' : `Open ${deployment.environment.toLowerCase()} preview`} <ExternalLink className="size-3" />
              </a>
            </li>
          ))}
        </ul>
      )}

      {ticket.description && <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Conversation</h2>
        <ul className="space-y-3">
          {ticket.comments.filter((comment) => !comment.deletedAt).map((comment) => (
            <li key={comment.id} className="rounded-lg border p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                {comment.author.name} · {comment.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </p>
              <p className="whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
        {canComment && <PortalComment ticketId={ticket.id} />}
      </section>
    </div>
  )
}
