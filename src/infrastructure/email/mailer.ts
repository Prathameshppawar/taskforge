import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Outgoing email over SMTP.
 *
 * Optional, like every other integration: without EMAIL_HOST, `sendMail`
 * reports that it did nothing and callers carry on — a report that could not be
 * emailed is still on the AI page.
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
  // One message, recipients hidden from each other: a report goes to managers
  // who need not see each other's addresses.
  await transport().sendMail({ from, to: from, bcc: message.to, subject: message.subject, html: message.html, text: message.text })
  return { sent: true }
}
