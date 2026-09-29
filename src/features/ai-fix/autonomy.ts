import { prisma } from '@/infrastructure/db/prisma'
import { asInstallation } from '@/infrastructure/github/client'
import { recordActivity } from '@/features/activity/service'
import { agentComment, agentUserId } from '@/features/agents/service'
import { rollupChecks } from '@/features/github/service'
import { evaluateAutoMerge, parseKinds } from '@/core/domain/auto-merge'

/**
 * What happens to an AI pull request after it opens, without a person:
 * marked ready once CI is green (draft-until-green), and merged when the
 * auto-merge policy is satisfied. Called whenever the facts change — a check
 * suite finishes, or the Reviewer delivers a verdict — and safe to call again:
 * each step checks the current state on GitHub before acting.
 */
export async function considerAiPullRequest(repoId: string, prNumber: number) {
  const origin = await prisma.aiFixRun.findFirst({
    where: { repoId, prNumber, mode: 'FIX', status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    select: {
      ticket: {
        select: {
          id: true,
          key: true,
          projectId: true,
          type: { select: { kind: true } },
          project: {
            select: {
              settings: {
                select: { aiDraftUntilGreen: true, aiAutoMerge: true, autoMergeMaxLines: true, autoMergeKinds: true },
              },
            },
          },
        },
      },
      repo: { select: { fullName: true, installation: { select: { installationId: true } } } },
    },
  })
  const settings = origin?.ticket.project.settings
  if (!origin || !settings || (!settings.aiDraftUntilGreen && !settings.aiAutoMerge)) return

  const { ticket, repo } = origin
  const installationId = repo.installation.installationId
  const path = `/repos/${repo.fullName}`

  const pull = await asInstallation<{
    node_id: string
    state: string
    draft: boolean
    merged: boolean
    additions: number
    deletions: number
    head: { sha: string }
  }>(installationId, `${path}/pulls/${prNumber}`)
  if (pull.state !== 'open' || pull.merged) return

  const suites = await asInstallation<{ check_suites: Array<{ status: string | null; conclusion: string | null; latest_check_runs_count?: number }> }>(
    installationId,
    `${path}/commits/${pull.head.sha}/check-suites`,
  )
  const ran = suites.check_suites.filter((suite) => (suite.latest_check_runs_count ?? 1) > 0)
  const checkState = rollupChecks(ran)

  // --- draft until green ------------------------------------------------------
  let isDraft = pull.draft
  if (settings.aiDraftUntilGreen && pull.draft && checkState === 'SUCCESS' && ran.length > 0) {
    const files = await changedFiles(installationId, path, prNumber)
    // A workflow change stays a draft whatever CI says: it is the one kind of
    // change a person must read before it can run on its own.
    if (!files.some((file) => /^\.github\/workflows\//i.test(file))) {
      await asInstallation(installationId, '/graphql', {
        method: 'POST',
        body: {
          query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }',
          variables: { id: pull.node_id },
        },
      })
      isDraft = false
      await asInstallation(installationId, `${path}/issues/${prNumber}/comments`, {
        method: 'POST',
        body: { body: '✅ Every check passed, so this is now ready for review.' },
      })
      await agentComment('coder', ticket.id, `Marked #${prNumber} ready for review: every check passed.`)
    }
  }

  // --- auto-merge ---------------------------------------------------------------
  if (!settings.aiAutoMerge) return
  const ref = await prisma.ticketGitRef.findFirst({
    where: { repoId, kind: 'PULL_REQUEST', externalId: String(prNumber), ticketId: ticket.id },
    select: { aiReviewVerdict: true },
  })
  const files = await changedFiles(installationId, path, prNumber)
  const decision = evaluateAutoMerge({
    enabled: settings.aiAutoMerge,
    allowedKinds: parseKinds(settings.autoMergeKinds),
    maxLines: settings.autoMergeMaxLines,
    ticketKind: ticket.type.kind,
    openedByAi: true,
    isDraft,
    checkState,
    checkCount: ran.length,
    reviewVerdict: ref?.aiReviewVerdict ?? null,
    additions: pull.additions,
    deletions: pull.deletions,
    files,
  })
  if (!decision.merge) return

  await asInstallation(installationId, `${path}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    // Pinned to the head that was checked: if anything was pushed since, GitHub
    // refuses rather than merging code nobody verified.
    body: { merge_method: 'squash', sha: pull.head.sha },
  })
  await agentComment(
    'coder',
    ticket.id,
    `🤖 **Auto-merged #${prNumber}.** Every condition of this project's policy held: CI passed, the Reviewer found nothing, ${
      pull.additions + pull.deletions
    } lines changed (limit ${settings.autoMergeMaxLines}), and ${ticket.type.kind.toLowerCase()} tickets are allowed.`,
  )
  await recordActivity(prisma, {
    action: 'UPDATED',
    entityType: 'TICKET',
    entityId: ticket.id,
    entityLabel: ticket.key,
    projectId: ticket.projectId,
    ticketId: ticket.id,
    actorId: await agentUserId('coder'),
    summary: `auto-merged pull request #${prNumber} under the project's policy`,
  })
}

async function changedFiles(installationId: bigint, path: string, prNumber: number): Promise<string[]> {
  const files = await asInstallation<Array<{ filename: string }>>(installationId, `${path}/pulls/${prNumber}/files?per_page=100`)
  return files.map((file) => file.filename)
}
