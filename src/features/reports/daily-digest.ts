import { prisma } from '@/infrastructure/db/prisma'
import { isEmailConfigured, sendMail } from '@/infrastructure/email/mailer'
import { sendActivity, teamsStatus } from '@/infrastructure/msteams/client'
import { appName, appUrl, escapeHtml, layout } from '@/features/notifications/email'
import { forecastCycle } from '@/features/forecast/queries'
import { daysFromNow } from '@/core/domain/forecast'

/**
 * The morning digest: for each project that asks for it, what a manager
 * should look at today — stuck, at risk, due, waiting on the client — and
 * what finished yesterday. Counted from the records, no model, so it costs
 * one email and is never wrong about a number.
 */

interface Line {
  key: string
  title: string
  note: string
}

async function projectDigest(projectId: string, now: Date) {
  const day = 86_400_000
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, settings: { select: { stuckAfterDays: true } } },
  })
  const open = { projectId, isArchived: false, completedAt: null }
  const stuckAfter = project.settings?.stuckAfterDays ?? null
  const [stuck, atRisk, due, waiting, finished, cycle] = await Promise.all([
    stuckAfter
      ? prisma.ticket.findMany({
          where: { ...open, status: { category: { in: ['IN_PROGRESS', 'REVIEW', 'BLOCKED'] } }, statusChangedAt: { lt: new Date(now.getTime() - stuckAfter * day) } },
          select: { key: true, title: true, statusChangedAt: true, status: { select: { name: true } } },
          take: 10,
        })
      : Promise.resolve([]),
    prisma.ticket.findMany({
      where: { ...open, slaAlerts: { some: {} } },
      select: { key: true, title: true, slaAlerts: { select: { kind: true } } },
      take: 10,
    }),
    prisma.ticket.findMany({
      where: { ...open, dueDate: { lt: new Date(now.getTime() + 3 * day) } },
      orderBy: { dueDate: 'asc' },
      select: { key: true, title: true, dueDate: true },
      take: 10,
    }),
    prisma.ticket.findMany({
      where: { ...open, status: { category: 'REVIEW' }, reporter: { role: { key: 'CLIENT' } } },
      select: { key: true, title: true, statusChangedAt: true },
      take: 10,
    }),
    prisma.ticket.count({ where: { projectId, completedAt: { gte: new Date(now.getTime() - day) }, status: { category: 'DONE' } } }),
    prisma.cycle.findFirst({ where: { projectId, state: 'ACTIVE' }, select: { id: true, name: true, endDate: true } }),
  ])
  const forecast = cycle ? await forecastCycle(cycle.id, now) : null
  const sections: Array<{ title: string; lines: Line[] }> = [
    { title: 'Stuck', lines: stuck.map((ticket) => ({ key: ticket.key, title: ticket.title, note: `${ticket.status.name} for ${Math.floor((now.getTime() - ticket.statusChangedAt.getTime()) / day)} days` })) },
    {
      title: 'Service targets',
      lines: atRisk.map((ticket) => ({ key: ticket.key, title: ticket.title, note: ticket.slaAlerts.some((alert) => alert.kind.endsWith(':breach')) ? 'breached' : 'at risk' })),
    },
    {
      title: 'Due soon or overdue',
      lines: due.map((ticket) => ({ key: ticket.key, title: ticket.title, note: ticket.dueDate! < now ? `overdue since ${ticket.dueDate!.toISOString().slice(0, 10)}` : `due ${ticket.dueDate!.toISOString().slice(0, 10)}` })),
    },
    { title: 'Waiting on the client', lines: waiting.map((ticket) => ({ key: ticket.key, title: ticket.title, note: `in review for ${Math.floor((now.getTime() - ticket.statusChangedAt.getTime()) / day)} days` })) },
  ].filter((section) => section.lines.length > 0)
  const cycleLine =
    cycle && forecast?.ok && forecast.remaining > 0
      ? `${cycle.name}: 85% likely by ${daysFromNow(forecast.forecast.p85, now).toISOString().slice(0, 10)}${forecast.forecast.onTime !== null ? ` — ${Math.round(forecast.forecast.onTime * 100)}% chance of its end date` : ''}.`
      : null
  return { name: project.name, sections, finished, cycleLine }
}

export async function sendDailyDigests(now = new Date()): Promise<{ projects: number; emailed: number }> {
  const projects = await prisma.project.findMany({ where: { isArchived: false, settings: { dailyDigest: true } }, select: { id: true } })
  let emailed = 0
  for (const { id } of projects) {
    const digest = await projectDigest(id, now)
    // A quiet day is not news: nothing to look at, nothing sent.
    if (digest.sections.length === 0 && !digest.cycleLine) continue
    const heading = `${digest.name} this morning`
    const text = [
      `${heading} — ${digest.finished} finished yesterday.`,
      ...(digest.cycleLine ? [digest.cycleLine] : []),
      ...digest.sections.flatMap((section) => ['', `${section.title}:`, ...section.lines.map((line) => `- ${line.key} ${line.title} (${line.note}) ${appUrl()}/tickets/${line.key}`)]),
    ].join('\n')

    if (isEmailConfigured()) {
      const managers = await prisma.projectMember.findMany({
        where: { projectId: id, role: 'MANAGER', user: { isActive: true, emailDigest: true } },
        select: { user: { select: { email: true } } },
      })
      const to = managers.map((member) => member.user.email)
      if (to.length) {
        const html = layout(
          appName(),
          `<h2 style="margin:4px 0 8px;font:600 18px system-ui">${escapeHtml(heading)}</h2>
<p style="margin:0 0 12px;color:#525252">${digest.finished} finished yesterday.${digest.cycleLine ? ` ${escapeHtml(digest.cycleLine)}` : ''}</p>
${digest.sections
  .map(
    (section) => `<h3 style="margin:16px 0 6px;font:600 14px system-ui">${escapeHtml(section.title)}</h3><ul style="margin:0;padding-left:18px">${section.lines
      .map((line) => `<li style="margin:2px 0"><a href="${escapeHtml(`${appUrl()}/tickets/${line.key}`)}" style="color:#2563eb">${escapeHtml(line.key)}</a> ${escapeHtml(line.title)} <span style="color:#737373">— ${escapeHtml(line.note)}</span></li>`)
      .join('')}</ul>`,
  )
  .join('\n')}`,
          'You receive this because the morning digest is on for this project and you manage it. Turn manager emails off in Settings → Notifications.',
        )
        const result = await sendMail({ to, subject: heading, html, text }).catch(() => ({ sent: false }))
        if (result.sent) emailed++
      }
    }

    const channels = (await teamsStatus()).connected ? await prisma.msTeamsConversation.findMany({ where: { projectId: id, kind: 'channel', notify: true } }) : []
    for (const channel of channels.filter((entry) => !entry.id.includes(';'))) {
      await sendActivity(channel.serviceUrl, channel.id, {
        type: 'message',
        textFormat: 'markdown',
        text: text.replace(/(^|\n)- ([A-Z][A-Z0-9]{1,9}-\d+) /g, (_, start, key) => `${start}- [${key}](${appUrl()}/tickets/${key}) `).replace(/ https?:\/\/\S+$/gm, ''),
      }).catch((error) => console.error('[digest] Teams post failed:', error))
    }
  }
  return { projects: projects.length, emailed }
}
