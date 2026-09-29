import { after } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { isEmailConfigured, sendMail } from '@/infrastructure/email/mailer'
import { appName, appUrl, button, escapeHtml, layout } from '@/features/notifications/email'
import { collectFacts, isQuietPeriod, type ReportFacts, type ReportTicket } from './service'

/**
 * What a project's managers are emailed: a Monday digest of the week, and an
 * alert the moment an urgent ticket is raised.
 *
 * "Managers" means members with the project's MANAGER role, active, who have
 * not turned manager emails off in Settings → Notifications.
 */

async function managerEmails(projectId: string, exceptUserId?: string): Promise<string[]> {
  const members = await prisma.projectMember.findMany({
    where: {
      projectId,
      role: 'MANAGER',
      user: { isActive: true, emailDigest: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    },
    select: { user: { select: { email: true } } },
  })
  return members.map((member) => member.user.email)
}

// -----------------------------------------------------------------------------
// Urgent-ticket alert
// -----------------------------------------------------------------------------

/**
 * A ticket is urgent when its kind is a production issue, or when it carries
 * the project's highest priority. Priorities are per project and renamable, so
 * "highest level" is the only meaning that survives a rename.
 */
export function alertManagersOfUrgentTicketLater(ticketId: string, actorId: string): void {
  if (!isEmailConfigured()) return
  try {
    after(() =>
      alertManagersOfUrgentTicket(ticketId, actorId).catch((error) =>
        console.error('[email] urgent-ticket alert failed:', error),
      ),
    )
  } catch {
    // Outside a request: nothing to defer to, and the ticket is on the board.
  }
}

async function alertManagersOfUrgentTicket(ticketId: string, actorId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      key: true,
      title: true,
      description: true,
      projectId: true,
      project: { select: { name: true } },
      type: { select: { name: true, kind: true } },
      priority: { select: { name: true, level: true } },
      assignee: { select: { name: true } },
      reporter: { select: { name: true } },
    },
  })
  if (!ticket) return

  const top = await prisma.priority.aggregate({
    where: { projectId: ticket.projectId },
    _max: { level: true },
  })
  const production = ticket.type.kind === 'PRODUCTION'
  const highest = ticket.priority.level === top._max.level
  if (!production && !highest) return

  const to = await managerEmails(ticket.projectId, actorId)
  if (to.length === 0) return

  await sendMail({ to, ...renderUrgentTicketEmail({ ...ticket, production }) })
}

export function renderUrgentTicketEmail(ticket: {
  key: string
  title: string
  description: string | null
  project: { name: string }
  type: { name: string }
  priority: { name: string }
  assignee: { name: string } | null
  reporter: { name: string } | null
  production: boolean
}) {
  const app = appName()
  const link = `${appUrl()}/tickets/${ticket.key}`
  const what = ticket.production ? 'Production issue' : `${ticket.priority.name} ticket`
  const subject = `${what} in ${ticket.project.name}: ${ticket.key} ${ticket.title}`
  const facts = [
    ['Type', ticket.type.name],
    ['Priority', ticket.priority.name],
    ['Raised by', ticket.reporter?.name ?? 'Unknown'],
    ['Assignee', ticket.assignee?.name ?? 'Nobody yet'],
  ]
  const summary = ticket.description ? truncate(ticket.description, 400) : null

  return {
    subject,
    html: layout(
      app,
      `<p style="margin:4px 0 0;color:#b91c1c;font-weight:600">${escapeHtml(what)} · ${escapeHtml(ticket.project.name)}</p>
<h2 style="margin:4px 0 12px;font:600 18px system-ui">${escapeHtml(ticket.key)} ${escapeHtml(ticket.title)}</h2>
<table style="border-collapse:collapse;font-size:13px">
${facts.map(([label, value]) => `<tr><td style="padding:3px 12px 3px 0;color:#737373">${label}</td><td style="padding:3px 0">${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
${summary ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #e5e5e5;color:#404040;white-space:pre-wrap">${escapeHtml(summary)}</blockquote>` : ''}
${button(`Open ${ticket.key}`, link)}`,
      footer(),
    ),
    text: `${what} · ${ticket.project.name}\n${ticket.key} ${ticket.title}\n\n${facts.map(([label, value]) => `${label}: ${value}`).join('\n')}\n${summary ? `\n${summary}\n` : ''}\n${link}\n\n${footerText()}\n`,
  }
}

// -----------------------------------------------------------------------------
// Monday digest
// -----------------------------------------------------------------------------

/**
 * One email per active project that has managers and something to say. A quiet
 * week is skipped, like the weekly update skips the model.
 */
export async function sendManagerDigests(): Promise<{ projects: number; sent: number }> {
  if (!isEmailConfigured()) return { projects: 0, sent: 0 }

  const projects = await prisma.project.findMany({
    where: { isArchived: false, members: { some: { role: 'MANAGER' } } },
    select: { id: true },
  })

  let sent = 0
  for (const project of projects) {
    try {
      const to = await managerEmails(project.id)
      if (to.length === 0) continue
      const facts = await collectFacts(project.id, 7)
      if (isQuietPeriod(facts)) continue
      const result = await sendMail({ to, ...renderDigestEmail(facts) })
      if (result.sent) sent++
    } catch (error) {
      // One project's failure must not cost every other project its digest.
      console.error(`[email] manager digest for project ${project.id} failed:`, error)
    }
  }
  return { projects: projects.length, sent }
}

export function renderDigestEmail(facts: ReportFacts) {
  const app = appName()
  const base = appUrl()
  const sections: Array<{ title: string; tickets: ReportTicket[]; alert?: boolean; days?: boolean }> = [
    { title: 'Needs attention: overdue', tickets: facts.overdue, alert: true },
    { title: 'Needs attention: blocked', tickets: facts.blocked, alert: true },
    { title: 'Needs attention: stalled', tickets: facts.stalled, alert: true, days: true },
    { title: 'Completed', tickets: facts.completed },
    { title: 'Moved into progress', tickets: facts.started },
    { title: 'Newly raised', tickets: facts.created },
  ].filter((section) => section.tickets.length > 0)

  const headline = `${facts.completed.length} completed, ${facts.created.length} raised, ${facts.overdue.length + facts.blocked.length} overdue or blocked`
  const detail = (ticket: ReportTicket, days?: boolean) =>
    `${ticket.title} · ${ticket.statusName} · ${ticket.assignee ?? 'unassigned'}${days && ticket.days ? ` · ${ticket.days}d untouched` : ''}`

  const html = layout(
    app,
    `<p style="margin:0;color:#737373">Weekly digest · ${escapeHtml(facts.projectName)} (${escapeHtml(facts.projectCode)})</p>
<h2 style="margin:4px 0 4px;font:600 18px system-ui">${escapeHtml(headline)}</h2>
<p style="margin:0;color:#737373">${facts.totals.open} open of ${facts.totals.total} tickets.</p>
${sections
  .map(
    (section) => `<h3 style="margin:20px 0 6px;font:600 14px system-ui;${section.alert ? 'color:#b91c1c' : ''}">${escapeHtml(section.title)} (${section.tickets.length})</h3>
<ul style="margin:0;padding-left:18px">
${section.tickets
  .map(
    (ticket) =>
      `<li style="margin:2px 0"><a href="${escapeHtml(`${base}/tickets/${ticket.key}`)}" style="color:#1a1a1a;font-weight:600">${escapeHtml(ticket.key)}</a> ${escapeHtml(detail(ticket, section.days))}</li>`,
  )
  .join('\n')}
</ul>`,
  )
  .join('\n')}`,
    footer(),
  )

  const text = `Weekly digest · ${facts.projectName} (${facts.projectCode})
${headline}
${facts.totals.open} open of ${facts.totals.total} tickets.
${sections.map((section) => `\n${section.title} (${section.tickets.length})\n${section.tickets.map((ticket) => `  ${ticket.key} ${detail(ticket, section.days)}`).join('\n')}`).join('\n')}

${footerText()}
`

  return { subject: `${facts.projectName} this week: ${headline}`, html, text }
}

function footer(): string {
  return `You manage this project in ${escapeHtml(appName())}. <a href="${escapeHtml(`${appUrl()}/settings/notifications`)}" style="color:#737373">Turn manager emails off</a>.`
}

function footerText(): string {
  return `You manage this project in ${appName()}. Turn manager emails off: ${appUrl()}/settings/notifications`
}

function truncate(value: string, max: number): string {
  const flat = value.trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
