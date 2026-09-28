import { prisma } from '@/infrastructure/db/prisma'
import { sendMail } from '@/infrastructure/email/mailer'
import { microsToUsd, monthKey, thresholdToAlert } from '@/core/domain/ai-budget'
import { subscriberEmails } from './reports'
import { spendThisMonth } from './usage'

/**
 * Budget alerts: after each recorded call, any budget covering it that has
 * just crossed 80% or 100% of its monthly limit emails its subscribers — once
 * per threshold per month.
 */
export async function checkBudgetAlerts(scope: { projectId: string | null; provider: string }) {
  const budgets = await prisma.aiBudget.findMany({
    where: {
      OR: [
        { scope: 'WORKSPACE' },
        ...(scope.projectId ? [{ scope: 'PROJECT' as const, projectId: scope.projectId }] : []),
        { scope: 'PROVIDER', provider: scope.provider },
      ],
    },
    include: { project: { select: { name: true, code: true } } },
  })

  const now = new Date()
  for (const budget of budgets) {
    const spent = await spendThisMonth({
      projectId: budget.scope === 'PROJECT' ? budget.projectId : null,
      provider: budget.scope === 'PROVIDER' ? budget.provider : null,
    })
    const limit = Number(budget.monthlyLimitUsd)
    const level = thresholdToAlert(spent, limit, budget.lastAlert, now)
    if (!level) continue

    // Claim the alert before sending, conditionally, so two calls finishing at
    // once cannot both send it.
    const claimed = await prisma.aiBudget.updateMany({
      where: { id: budget.id, lastAlert: budget.lastAlert },
      data: { lastAlert: `${monthKey(now)}:${level}` },
    })
    if (claimed.count === 0) continue

    const what =
      budget.scope === 'WORKSPACE'
        ? 'The workspace'
        : budget.scope === 'PROJECT'
          ? `${budget.project?.name ?? 'A project'} (${budget.project?.code ?? '?'})`
          : `The ${budget.provider} engine`
    const spentUsd = microsToUsd(spent)
    const subject =
      level === 100
        ? `AI budget reached: ${what} has spent $${spentUsd.toFixed(2)} of $${limit.toFixed(2)}`
        : `AI budget at 80%: ${what} has spent $${spentUsd.toFixed(2)} of $${limit.toFixed(2)}`
    const consequence =
      level === 100 && budget.hardStop
        ? 'New AI runs in this scope are now refused until the limit is raised or the month ends.'
        : 'Nothing is blocked; this is a warning.'

    const recipients = await subscriberEmails('AI_BUDGET_ALERT')
    await sendMail({
      to: recipients,
      subject,
      text: `${subject} for ${monthKey(now)}.\n${consequence}\n\n${process.env.NEXT_PUBLIC_APP_URL ?? ''}/workspace/ai`,
      html: `<div style="font:14px system-ui;max-width:560px"><h2 style="font:600 18px system-ui">${subject}</h2>
<p>For ${monthKey(now)}. ${consequence}</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/workspace/ai">Open the AI page</a></p></div>`,
    }).catch((error) => console.error('[ai-budget] alert email failed:', error))
  }
}

/** Every budget with this month's spend, for the AI page. */
export async function listBudgets() {
  const budgets = await prisma.aiBudget.findMany({
    orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }],
    include: { project: { select: { id: true, name: true, code: true } } },
  })
  return Promise.all(
    budgets.map(async (budget) => {
      const spent = microsToUsd(
        await spendThisMonth({
          projectId: budget.scope === 'PROJECT' ? budget.projectId : null,
          provider: budget.scope === 'PROVIDER' ? budget.provider : null,
        }),
      )
      const limit = Number(budget.monthlyLimitUsd)
      return {
        id: budget.id,
        scope: budget.scope,
        provider: budget.provider,
        project: budget.project,
        limitUsd: limit,
        spentUsd: spent,
        percent: limit > 0 ? Math.round((spent / limit) * 100) : 0,
        hardStop: budget.hardStop,
      }
    }),
  )
}

export type BudgetRow = Awaited<ReturnType<typeof listBudgets>>[number]
