import { after } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { isEmailConfigured, sendMail } from '@/infrastructure/email/mailer'

/**
 * Notification emails: the bell's notifications, delivered to the inbox too.
 *
 * `notify` runs inside the caller's transaction, and a message cannot be
 * unsent, so nothing goes out from there. The ids are handed to `after()`,
 * which runs once the response is finished. By then the transaction has
 * either committed or rolled back, and re-reading the rows by id sends only the
 * ones that exist. A rolled-back comment emails nobody.
 */

export function emailNotificationsLater(ids: string[]): void {
  if (ids.length === 0 || !isEmailConfigured()) return
  try {
    after(() =>
      emailNotifications(ids).catch((error) =>
        console.error('[email] notification emails failed:', error),
      ),
    )
  } catch {
    // Outside a request (a script, the seed): there is nobody waiting on a
    // response, and the bell still has the notification.
  }
}

async function emailNotifications(ids: string[]): Promise<void> {
  const rows = await prisma.notification.findMany({
    where: {
      id: { in: ids },
      user: { isActive: true, emailNotifications: true },
    },
    select: {
      title: true,
      body: true,
      user: { select: { email: true, name: true } },
      ticket: { select: { key: true, title: true } },
    },
  })

  for (const row of rows) {
    await sendMail({ to: [row.user.email], ...renderNotificationEmail(row) })
  }
}

export function renderNotificationEmail(row: {
  title: string
  body: string | null
  ticket: { key: string; title: string } | null
}) {
  const app = appName()
  const link = row.ticket ? `${appUrl()}/tickets/${row.ticket.key}` : `${appUrl()}/inbox`
  const footer = `You are receiving this because notifications are emailed to you. Turn them off in Settings → Notifications: ${appUrl()}/settings/notifications`

  return {
    subject: row.title,
    html: layout(
      app,
      `<h2 style="margin:4px 0 12px;font:600 18px system-ui">${escapeHtml(row.title)}</h2>
${row.ticket ? `<p style="margin:0 0 8px;color:#737373">${escapeHtml(row.ticket.key)} · ${escapeHtml(row.ticket.title)}</p>` : ''}
${row.body && row.body !== row.ticket?.title ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #e5e5e5;color:#404040">${escapeHtml(row.body)}</blockquote>` : ''}
${button(row.ticket ? `Open ${row.ticket.key}` : 'Open inbox', link)}`,
      `You are receiving this because notifications are emailed to you. <a href="${escapeHtml(`${appUrl()}/settings/notifications`)}" style="color:#737373">Turn them off</a>.`,
    ),
    text: `${row.title}\n${row.ticket ? `${row.ticket.key} · ${row.ticket.title}\n` : ''}${row.body && row.body !== row.ticket?.title ? `\n${row.body}\n` : ''}\n${link}\n\n${footer}\n`,
  }
}

// -----------------------------------------------------------------------------
// Shared pieces for the product's own emails
// -----------------------------------------------------------------------------

export function appName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || 'TaskForge'
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || '').replace(/\/$/, '')
}

export function layout(app: string, content: string, footer: string): string {
  return `<div style="max-width:600px;margin:0 auto;font:14px/1.5 system-ui;color:#1a1a1a">
<p style="color:#737373;margin:0">${escapeHtml(app)}</p>
${content}
<p style="margin-top:24px;color:#737373;font-size:12px">${footer}</p>
</div>`
}

export function button(label: string, href: string): string {
  return `<p style="margin:16px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
