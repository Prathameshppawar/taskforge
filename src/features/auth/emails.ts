import { sendMail } from '@/infrastructure/email/mailer'
import { appName, appUrl, escapeHtml } from '@/features/notifications/email'

/**
 * Account emails: the welcome message when an administrator creates someone,
 * and the notice when an administrator resets their password.
 *
 * Both carry the temporary password, because there is no self sign-up and no
 * "forgot password" link — the email is how the person gets in. With "require
 * a password change" on (the default) that password is good for one sign-in.
 */

export interface AccountEmailInput {
  name: string
  username: string
  email: string
  password: string
  mustChangePassword: boolean
}

export interface EmailOutcome {
  sent: boolean
  reason?: string
}

function signInUrl(): string {
  return `${appUrl()}/login`
}

function render(input: AccountEmailInput, kind: 'welcome' | 'reset') {
  const app = appName()
  const url = signInUrl()
  const firstName = input.name.split(/\s+/)[0]

  const subject =
    kind === 'welcome' ? `Your ${app} account is ready` : `Your ${app} password has been reset`
  const intro =
    kind === 'welcome'
      ? `An account has been created for you on ${app}. Here is how to sign in.`
      : `An administrator has reset your ${app} password, and you have been signed out everywhere. Use these details to sign back in.`
  const next = input.mustChangePassword
    ? 'This password is temporary: you will be asked to choose your own as soon as you sign in.'
    : 'You can change this password at any time from Settings once you are signed in.'
  const caution =
    kind === 'welcome'
      ? 'If you were not expecting this account, you can ignore this email.'
      : 'If you did not ask for this, tell your administrator.'

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#737373">${label}</td>
<td style="padding:6px 0;font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(value)}</td></tr>`

  const html = `<div style="max-width:560px;margin:0 auto;font:14px/1.5 system-ui;color:#1a1a1a">
<p style="color:#737373;margin:0">${escapeHtml(app)}</p>
<h2 style="margin:4px 0 16px;font:600 20px system-ui">${escapeHtml(subject)}</h2>
<p>Hi ${escapeHtml(firstName)},</p>
<p>${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;margin:16px 0">
${row('Username', input.username)}
${row('Password', input.password)}
</table>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600">Sign in to ${escapeHtml(app)}</a></p>
<p>${escapeHtml(next)}</p>
<p style="margin-top:24px;color:#737373;font-size:12px">You sign in with your username, not your email address. ${escapeHtml(caution)}</p>
</div>`

  const text = `Hi ${firstName},

${intro}

Username: ${input.username}
Password: ${input.password}

Sign in: ${url}

${next}

You sign in with your username, not your email address. ${caution}
`

  return { subject, html, text }
}

export function renderWelcomeEmail(input: AccountEmailInput) {
  return render(input, 'welcome')
}

export function renderPasswordResetEmail(input: AccountEmailInput) {
  return render(input, 'reset')
}

/**
 * Sends an account email. It never throws: the account change has already been
 * committed, and a mail server being down must not turn that into an error.
 */
export async function sendAccountEmail(
  kind: 'welcome' | 'reset',
  input: AccountEmailInput,
): Promise<EmailOutcome> {
  try {
    return await sendMail({ to: [input.email], ...render(input, kind) })
  } catch (error) {
    console.error(`[email] ${kind} email to ${input.email} failed`, error)
    return { sent: false, reason: 'The mail server rejected the message.' }
  }
}
