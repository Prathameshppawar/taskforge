import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Outgoing email over SMTP.
 *
 * Optional, like every other integration: without EMAIL_HOST, `sendMail`
 * reports that it did nothing and callers carry on — a report that could not be
 * emailed is still on the AI page, and an account whose welcome email did not
 * go out still exists.
 */

let transporter: Transporter | null = null

export function isEmailConfigured(): boolean {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS)
}

function transport(): Transporter {
  if (transporter) return transporter
  const port = Number(process.env.EMAIL_PORT ?? 587)
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  })
  return transporter
}

export async function sendMail(message: {
  to: string[]
  subject: string
  html: string
  text: string
}): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured()) return { sent: false, reason: 'Email is not configured (EMAIL_HOST).' }
  if (message.to.length === 0) return { sent: false, reason: 'Nobody is subscribed.' }

  const from = process.env.EMAIL_FROM || `${process.env.NEXT_PUBLIC_APP_NAME || 'TaskForge'} <${process.env.EMAIL_USER}>`
  const content = { from, subject: message.subject, html: message.html, text: message.text }
  if (message.to.length === 1) {
    // Addressed to one person (their welcome email, say): put them in To, where
    // a mail client expects to see its owner.
    await transport().sendMail({ ...content, to: message.to[0] })
    return { sent: true }
  }
  // One message, recipients hidden from each other: a report goes to managers
  // who need not see each other's addresses.
  await transport().sendMail({ ...content, to: from, bcc: message.to })
  return { sent: true }
}
