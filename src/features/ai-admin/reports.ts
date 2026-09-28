import type { ReportKind } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { sendMail } from '@/infrastructure/email/mailer'
import { lastWeekRange, microsToUsd } from '@/core/domain/ai-budget'

/**
 * AI usage, aggregated in the database: by person, by project, by provider and
 * model, by feature. The same numbers feed the AI page and the weekly email, so
 * the two can never disagree.
 */

export interface UsageRow {
  key: string
  label: string
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface UsageReport {
  from: Date
  to: Date
  total: Omit<UsageRow, 'key' | 'label'>
  byUser: UsageRow[]
  byProject: UsageRow[]
  byModel: UsageRow[]
  byFeature: UsageRow[]
}

const FEATURE_LABELS: Record<string, string> = {
  COPILOT: 'Copilot',
  AI_FIX: 'Fix with AI',
  CAPTURE: 'Capture',
  FILTER: 'Describe a view',
  WEEKLY_UPDATE: 'Weekly update',
}

export async function usageReport(from: Date, to: Date): Promise<UsageReport> {
  const where = { createdAt: { gte: from, lt: to } }
  const sum = { inputTokens: true, outputTokens: true, costMicros: true } as const

  const [total, users, projects, models, features] = await Promise.all([
    prisma.aiUsageEvent.aggregate({ where, _sum: sum, _count: true }),
    prisma.aiUsageEvent.groupBy({ by: ['userId'], where, _sum: sum, _count: true }),
    prisma.aiUsageEvent.groupBy({ by: ['projectId'], where, _sum: sum, _count: true }),
    prisma.aiUsageEvent.groupBy({ by: ['provider', 'model'], where, _sum: sum, _count: true }),
    prisma.aiUsageEvent.groupBy({ by: ['feature'], where, _sum: sum, _count: true }),
  ])

  const [people, projectRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: users.map((row) => row.userId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { id: { in: projects.map((row) => row.projectId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, name: true, code: true },
    }),
  ])
  const personName = new Map(people.map((person) => [person.id, person.name]))
  const projectName = new Map(projectRows.map((project) => [project.id, `${project.name} (${project.code})`]))

  type Grouped = { _sum: { inputTokens: number | null; outputTokens: number | null; costMicros: bigint | null }; _count: number }
  const row = (key: string, label: string, group: Grouped): UsageRow => ({
    key,
    label,
    calls: group._count,
    inputTokens: group._sum.inputTokens ?? 0,
    outputTokens: group._sum.outputTokens ?? 0,
    costUsd: microsToUsd(group._sum.costMicros ?? BigInt(0)),
  })
  // Most expensive first; tokens break ties, which matters while prices are unset.
  const rank = (rows: UsageRow[]) =>
    rows.sort((a, b) => b.costUsd - a.costUsd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))

  return {
    from,
    to,
    total: {
      calls: total._count,
      inputTokens: total._sum.inputTokens ?? 0,
      outputTokens: total._sum.outputTokens ?? 0,
      costUsd: microsToUsd(total._sum.costMicros ?? BigInt(0)),
    },
    byUser: rank(users.map((g) => row(g.userId ?? 'none', g.userId ? (personName.get(g.userId) ?? 'Removed user') : 'No one (system)', g))),
    byProject: rank(projects.map((g) => row(g.projectId ?? 'none', g.projectId ? (projectName.get(g.projectId) ?? 'Removed project') : 'No project', g))),
    byModel: rank(models.map((g) => row(`${g.provider}/${g.model}`, `${g.provider} · ${g.model}`, g))),
    byFeature: rank(features.map((g) => row(g.feature, FEATURE_LABELS[g.feature] ?? g.feature, g))),
  }
}

/** Email addresses subscribed to a report, directly or through a team. */
export async function subscriberEmails(kind: ReportKind): Promise<string[]> {
  const subscriptions = await prisma.reportSubscription.findMany({
    where: { kind },
    select: {
      user: { select: { email: true, isActive: true } },
      team: { select: { members: { select: { user: { select: { email: true, isActive: true } } } } } },
    },
  })
  const emails = new Set<string>()
  for (const subscription of subscriptions) {
    if (subscription.user?.isActive) emails.add(subscription.user.email)
    for (const member of subscription.team?.members ?? []) {
      if (member.user.isActive) emails.add(member.user.email)
    }
  }
  return [...emails].sort()
}

// -----------------------------------------------------------------------------
// The weekly email
// -----------------------------------------------------------------------------

const usd = (value: number) => (value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`)
const tokens = (row: { inputTokens: number; outputTokens: number }) =>
  `${((row.inputTokens + row.outputTokens) / 1000).toFixed(1)}k`

function table(title: string, rows: UsageRow[]): { html: string; text: string } {
  const top = rows.slice(0, 8)
  if (top.length === 0) return { html: '', text: '' }
  return {
    html: `<h3 style="margin:24px 0 8px;font:600 14px system-ui">${title}</h3>
<table style="border-collapse:collapse;font:13px system-ui;width:100%">
${top
  .map(
    (r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(r.label)}</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${r.calls} calls</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${tokens(r)} tokens</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${usd(r.costUsd)}</td></tr>`,
  )
  .join('\n')}
</table>`,
    text: `\n${title}\n${top.map((r) => `  ${r.label}: ${usd(r.costUsd)} · ${tokens(r)} tokens · ${r.calls} calls`).join('\n')}\n`,
  }
}

export function renderUsageEmail(report: UsageReport, appUrl: string) {
  const range = `${report.from.toISOString().slice(0, 10)} – ${new Date(report.to.getTime() - 1).toISOString().slice(0, 10)}`
  const sections = [
    table('By person', report.byUser),
    table('By project', report.byProject),
    table('By engine', report.byModel),
    table('By feature', report.byFeature),
  ]
  const headline = `${usd(report.total.costUsd)} across ${report.total.calls} AI calls (${tokens(report.total)} tokens)`

  return {
    subject: `AI usage ${range}: ${usd(report.total.costUsd)}`,
    html: `<div style="max-width:640px;margin:0 auto;font:14px system-ui;color:#1a1a1a">
<p style="color:#737373;margin:0">AI usage · ${range}</p>
<h2 style="margin:4px 0 0;font:600 20px system-ui">${headline}</h2>
${sections.map((section) => section.html).join('\n')}
<p style="margin-top:24px;color:#737373;font-size:12px">Costs use the prices on the AI page; models without a price count as $0.
<a href="${appUrl}/workspace/ai">Open the AI page</a> to change budgets or who receives this.</p>
</div>`,
    text: `AI usage · ${range}\n${headline}\n${sections.map((section) => section.text).join('')}\n${appUrl}/workspace/ai\n`,
  }
}

/** Sends last week's report to its subscribers. Called by the Monday cron and "Send now". */
export async function sendWeeklyUsageReport(now = new Date()) {
  const { from, to } = lastWeekRange(now)
  const [report, recipients] = await Promise.all([usageReport(from, to), subscriberEmails('AI_USAGE_WEEKLY')])
  const email = renderUsageEmail(report, process.env.NEXT_PUBLIC_APP_URL ?? '')
  const result = await sendMail({ to: recipients, ...email })
  return { ...result, recipients: recipients.length }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
