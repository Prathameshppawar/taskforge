import type { Prisma } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { type CodingEngineId, AiProviderError } from '@/infrastructure/ai'
import { agentEngine, getEngineProvider } from '@/features/ai-admin/engines'
import { metered } from '@/features/ai-admin/usage'
import { asInstallation, GithubApiError } from '@/infrastructure/github/client'
import { recordActivity } from '@/features/activity/service'
import { branchNameFor, TICKET_KIND_LABELS } from '@/core/domain/git-refs'
import { uniqueBranch } from '@/core/domain/ai-fix'
import { agentComment, agentUserId } from '@/features/agents/service'
import { describeFailures } from './ci-failures'
import { gatherTicketContext } from './context'
import { runFixAgent } from './agent'
import { RepoWorkspace } from './workspace'

/**
 * Runs one "Fix with AI" attempt to completion.
 *
 * Called after the request that started it has already answered, so every
 * outcome — a pull request, no changes, or a failure with a reason — is written
 * to the run row, never thrown at a caller who is no longer listening.
 */
export async function executeFixRun(runId: string): Promise<void> {
  const run = await prisma.aiFixRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      mode: true,
      provider: true,
      model: true,
      instructions: true,
      targetPrNumber: true,
      planRunId: true,
      batchId: true,
      requestedById: true,
      requestedBy: { select: { name: true } },
      ticket: {
        select: {
          id: true,
          key: true,
          title: true,
          description: true,
          projectId: true,
          type: { select: { kind: true } },
          checklist: { select: { text: true, isDone: true }, orderBy: { position: 'asc' } },
          project: { select: { settings: { select: { aiWorkflows: true, aiDraftUntilGreen: true } } } },
        },
      },
      repo: {
        select: {
          fullName: true,
          defaultBranch: true,
          installation: { select: { installationId: true } },
        },
      },
    },
  })
  if (!run) return

  await prisma.aiFixRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date() } })

  const { ticket, repo } = run
  const installationId = repo.installation.installationId
  const byline = `${run.provider} · ${run.model}`

  try {
    const provider = metered(await getEngineProvider(run.provider as CodingEngineId, run.model), {
      feature: 'AI_FIX',
      userId: run.requestedById,
      projectId: ticket.projectId,
      ticketKey: ticket.key,
    })
    const allowWorkflows = ticket.project.settings?.aiWorkflows ?? false
    const agentTicket = {
      key: ticket.key,
      title: ticket.title,
      description: ticket.description,
      kindLabel: TICKET_KIND_LABELS[ticket.type.kind].label,
      criteria: ticket.checklist,
    }
    // Written every turn, so a run that fails midway still shows what it did
    // and what it cost.
    const onProgress = async (progress: { turns: number; transcript: string[]; inputTokens: number; outputTokens: number }) => {
      await prisma.aiFixRun.update({
        where: { id: runId },
        data: {
          turns: progress.turns,
          transcript: progress.transcript.join('\n'),
          inputTokens: progress.inputTokens,
          outputTokens: progress.outputTokens,
        },
      })
    }

    // --- HEAL_CI: work on the pull request's own branch ----------------------
    let baseBranch = repo.defaultBranch
    let ciFailures: string | null = null
    let pullForHeal: { number: number; html_url: string; head: { ref: string; sha: string } } | null = null
    if (run.mode === 'HEAL_CI') {
      if (!run.targetPrNumber) throw new Error('No pull request was given to heal.')
      pullForHeal = await asInstallation(installationId, `/repos/${repo.fullName}/pulls/${run.targetPrNumber}`)
      ciFailures = await describeFailures(installationId, repo.fullName, pullForHeal!.head.sha)
      if (!ciFailures) {
        await finish(runId, { status: 'NO_CHANGES', summary: `The checks on #${run.targetPrNumber} are not failing any more.` })
        return
      }
      baseBranch = pullForHeal!.head.ref
    }

    const approvedPlan = run.planRunId
      ? ((await prisma.aiFixRun.findUnique({ where: { id: run.planRunId }, select: { summary: true } }))?.summary ?? null)
      : null

    const workspace = await RepoWorkspace.open(installationId, repo.fullName, baseBranch, { allowWorkflows })
    const ticketContext = await gatherTicketContext(ticket.id, installationId).catch((error) => {
      console.error('[ai-fix] could not gather ticket context:', error)
      return null
    })
    const result = await runFixAgent({
      provider,
      workspace,
      ticket: agentTicket,
      instructions: run.instructions,
      mode: run.mode,
      ciFailures,
      approvedPlan,
      ticketContext,
      onProgress,
    })
    const usage = {
      turns: result.turns,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      transcript: result.transcript.join('\n'),
    }

    // --- PLAN: post it, change nothing ----------------------------------------
    if (run.mode === 'PLAN') {
      await agentComment(
        'planner',
        ticket.id,
        `**Plan: ${result.title}**\n\n${result.summary}\n\n_Written by ${byline}${
          run.requestedBy ? ` for ${run.requestedBy.name}` : ''
        }. Nothing has been changed yet — approve it from **Fix with AI** to have it built._`,
      )
      await finish(runId, { ...usage, status: 'SUCCEEDED', summary: result.summary })
      await recordActivity(prisma, {
        action: 'AI_GENERATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: await agentUserId('planner'),
        summary: `posted an implementation plan for ${ticket.key} (${byline})`,
      })
      return
    }

    const changes = await workspace.changes()
    if (changes.length === 0) {
      await finish(runId, { ...usage, status: 'NO_CHANGES', summary: result.summary })
      return
    }

    const footer = `Generated by TaskForge's AI fix (${byline}) for ${ticket.key}${
      run.requestedBy ? `, requested by ${run.requestedBy.name}` : ''
    }.`

    // --- HEAL_CI: a new commit on the existing branch -------------------------
    if (run.mode === 'HEAL_CI' && pullForHeal) {
      const commit = await workspace.commit(
        baseBranch,
        `${ticket.key}: fix failing checks\n\n${result.summary}\n\n${footer}`,
        { onto: true },
      )
      await asInstallation(installationId, `/repos/${repo.fullName}/issues/${pullForHeal.number}/comments`, {
        method: 'POST',
        body: {
          body: `🔧 Pushed ${commit.sha.slice(0, 7)} to fix the failing checks.\n\n${result.summary}\n\n_${footer}_`,
        },
      })
      await finish(runId, {
        ...usage,
        status: 'SUCCEEDED',
        branch: baseBranch,
        prNumber: pullForHeal.number,
        prUrl: pullForHeal.html_url,
        summary: result.summary,
        changedFiles: commit.files.join('\n'),
      })
      await recordActivity(prisma, {
        action: 'AI_GENERATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: await agentUserId('coder'),
        summary: `pushed a fix for failing checks to pull request #${pullForHeal.number} (${byline})`,
      })
      return
    }

    // --- FIX: a new branch and a pull request ---------------------------------
    // The ticket's own branch name, so the existing integration links it —
    // suffixed if a person (or an earlier run) already has that branch.
    const base = branchNameFor(ticket.key, ticket.title, ticket.type.kind)
    const existing = await asInstallation<Array<{ ref: string }>>(
      installationId,
      `/repos/${repo.fullName}/git/matching-refs/heads/${base}`,
    )
    const branch = uniqueBranch(base, new Set(existing.map((ref) => ref.ref.replace('refs/heads/', ''))))

    const workflows = await workspace.touchesWorkflows()
    // Draft until green only where there is CI to turn it green; a repository
    // without checks would leave the pull request a draft forever.
    const hasCi =
      (ticket.project.settings?.aiDraftUntilGreen ?? false) &&
      (
        await asInstallation<{ total_count: number }>(installationId, `/repos/${repo.fullName}/commits/${workspace.baseSha}/check-suites`).catch(
          () => ({ total_count: 0 }),
        )
      ).total_count > 0
    const commit = await workspace.commit(branch, `${ticket.key}: ${result.title}\n\n${result.summary}\n\n${footer}`)

    const pull = await asInstallation<{ number: number; html_url: string }>(
      installationId,
      `/repos/${repo.fullName}/pulls`,
      {
        method: 'POST',
        body: {
          title: `${ticket.key}: ${result.title}`,
          head: branch,
          base: repo.defaultBranch,
          // A workflow runs the moment it is merged, so these never open ready
          // to merge: someone has to mark them ready, having read them.
          draft: workflows || hasCi,
          body: [
            ...(workflows
              ? [
                  '> [!WARNING]',
                  '> This pull request adds or changes a GitHub Actions workflow. It passed TaskForge’s checks — no secrets beyond `GITHUB_TOKEN`, no `pull_request_target`, third-party actions pinned — but read every step before marking it ready: once merged it runs on its own.',
                  '',
                ]
              : []),
            ...(approvedPlan ? ['Built from the plan approved on the ticket.', ''] : []),
            result.summary,
            '',
            '---',
            `${footer} It was written without running the code or its tests — review it as you would any contributor's, and let CI have its say. TaskForge never merges an AI change.`,
            ...(result.finished ? [] : ['', '> The model did not call `finish`, so this may be incomplete.']),
          ].join('\n'),
        },
      },
    )

    await finish(runId, {
      ...usage,
      status: 'SUCCEEDED',
      branch,
      prNumber: pull.number,
      prUrl: pull.html_url,
      summary: result.summary,
      changedFiles: commit.files.join('\n'),
    })
    await recordActivity(prisma, {
      action: 'AI_GENERATED',
      entityType: 'TICKET',
      entityId: ticket.id,
      entityLabel: ticket.key,
      projectId: ticket.projectId,
      ticketId: ticket.id,
      actorId: await agentUserId('coder'),
      summary: `opened pull request #${pull.number} in ${repo.fullName} (${byline}, ${commit.files.length} ${
        commit.files.length === 1 ? 'file' : 'files'
      }${run.requestedBy ? `, for ${run.requestedBy.name}` : ''})`,
    })

    if (run.batchId) await crossLinkBatch(run.batchId, runId).catch((error) => console.error('[ai-fix] cross-linking failed:', error))

    // A second pair of eyes before any person looks: the Reviewer reads the
    // Coder's pull request against the ticket. Best effort — a failed review
    // must not turn a successful fix into a failed run.
    await autoReview(ticket.id, repo.fullName, pull.number, run.requestedById)
  } catch (error) {
    console.error(`[ai-fix] run ${runId} failed:`, error)
    // GitHub's refusal for a workflow file does not always say "workflow", so
    // whether this run wrote one is read from its own record.
    const record = await prisma.aiFixRun.findUnique({ where: { id: runId }, select: { transcript: true } }).catch(() => null)
    const wroteWorkflow = /write_file \.github\/workflows\//.test(record?.transcript ?? '')
    await finish(runId, { status: 'FAILED', error: explain(error, wroteWorkflow) })
  }
}

/**
 * A ticket fixed across several repositories: each pull request names the
 * others, so whoever reviews one knows the rest exist and in what order to
 * merge them. Posted by each run as it finishes, onto its own pull request and
 * the ones already open, so the links are complete once the last run is done.
 */
async function crossLinkBatch(batchId: string, runId: string) {
  const siblings = await prisma.aiFixRun.findMany({
    where: { batchId, status: 'SUCCEEDED', prNumber: { not: null } },
    select: {
      id: true,
      prNumber: true,
      prUrl: true,
      repo: { select: { fullName: true, installation: { select: { installationId: true } } } },
    },
  })
  const self = siblings.find((entry) => entry.id === runId)
  const others = siblings.filter((entry) => entry.id !== runId)
  if (!self || others.length === 0) return

  const comment = (installationId: bigint, fullName: string, prNumber: number, body: string) =>
    asInstallation(installationId, `/repos/${fullName}/issues/${prNumber}/comments`, { method: 'POST', body: { body } })

  await comment(
    self.repo.installation.installationId,
    self.repo.fullName,
    self.prNumber!,
    `🔗 Part of a change across repositories. Related pull requests:\n${others.map((entry) => `- ${entry.repo.fullName}#${entry.prNumber} ${entry.prUrl}`).join('\n')}`,
  )
  for (const other of others) {
    await comment(
      other.repo.installation.installationId,
      other.repo.fullName,
      other.prNumber!,
      `🔗 Related pull request for the same ticket: ${self.repo.fullName}#${self.prNumber} ${self.prUrl}`,
    )
  }
}

async function autoReview(
  ticketId: string,
  fullName: string,
  prNumber: number,
  requestedById: string | null,
) {
  try {
    // The webhook may not have recorded the pull request yet; wait briefly.
    let ref = null
    for (let attempt = 0; attempt < 5 && !ref; attempt++) {
      ref = await prisma.ticketGitRef.findFirst({
        where: { ticketId, kind: 'PULL_REQUEST', externalId: String(prNumber), repo: { fullName } },
        select: { id: true },
      })
      if (!ref) await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    if (!ref) return
    // The Reviewer's own engine, not the Coder's: a second opinion is worth
    // more from a different model than from the one that wrote the change.
    const reviewer = await agentEngine('reviewer')
    if (!reviewer) return
    const { reviewPullRequest } = await import('@/features/ai-review/service')
    await reviewPullRequest({
      ticketId,
      refId: ref.id,
      engine: reviewer.id,
      engineModel: reviewer.model,
      requestedById: requestedById ?? (await agentUserId('coder')),
    })
  } catch (error) {
    console.error('[ai-fix] automatic review failed:', error)
  }
}

async function finish(runId: string, data: Prisma.AiFixRunUpdateInput) {
  await prisma.aiFixRun.update({ where: { id: runId }, data: { ...data, finishedAt: new Date() } })
}

/** A failure a person can act on, rather than a stack trace. */
export function explain(error: unknown, wroteWorkflow = false): string {
  if (error instanceof AiProviderError) return error.message
  if (error instanceof GithubApiError) {
    if ((wroteWorkflow || /workflow/i.test(error.message)) && (error.status === 403 || error.status === 404 || /workflow/i.test(error.message)) && error.status >= 400 && error.status < 500) {
      return 'GitHub refused to write a workflow file (.github/workflows). Workflow files need their own permission: in the TaskForge app’s settings on GitHub, set Repository permissions → Workflows to “Read and write”, then accept the new permission on the installation.'
    }
    if (error.status === 422 && /reference|fast.?forward|update is not a/i.test(error.message)) {
      return 'Someone pushed to the pull request while the fix was being written, so it was not applied. Run it again.'
    }
    if (error.status === 403 || error.status === 404) {
      return 'GitHub refused the write. The TaskForge app needs read & write access to Contents and Pull requests on this repository — update its permissions on GitHub and accept them on the installation.'
    }
    return `GitHub returned ${error.status}: ${error.message}`
  }
  return error instanceof Error ? error.message.slice(0, 300) : 'The run failed.'
}

/**
 * Runs left QUEUED or RUNNING by a process that died — a redeploy, a function
 * timeout — would otherwise block the ticket forever. Anything that has not
 * moved in fifteen minutes is marked failed.
 */
export async function expireStaleRuns(ticketId?: string) {
  await prisma.aiFixRun.updateMany({
    where: {
      ...(ticketId ? { ticketId } : {}),
      status: { in: ['QUEUED', 'RUNNING'] },
      updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: {
      status: 'FAILED',
      error: 'The run stopped without reporting back — the server may have restarted or timed out.',
      finishedAt: new Date(),
    },
  })
}
