import type { GitCheckState, GitRefKind, GitRefState } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { asApp, asInstallation } from '@/infrastructure/github/client'
import { seal } from '@/infrastructure/github/secrets'
import { recordActivity } from '@/features/activity/service'
import {
  extractTicketKeys,
  mayAdvance,
  targetCategoryFor,
  type GitEvent,
} from '@/core/domain/git-refs'
import { isTerminal } from '@/core/domain/ticket-rules'

/**
 * GitHub integration: installs, repositories, and the development artefacts
 * that mention tickets.
 *
 * Two paths feed the same upsert:
 *   - **webhooks**, which are immediate but can be missed — a deployment that
 *     was down, a tunnel that had closed, a delivery GitHub gave up on; and
 *   - **reconciliation**, which asks GitHub for the current state of a linked
 *     repository and records whatever the webhooks did not.
 * Because both land in one idempotent upsert, running them together, twice, or
 * out of order converges on the same rows. Neither is the source of truth on
 * its own; GitHub is.
 */

// -----------------------------------------------------------------------------
// GitHub payload shapes — only the fields this file reads.
// -----------------------------------------------------------------------------

export interface GhAccount {
  login: string
  type: string
  avatar_url?: string
}

export interface GhInstallation {
  id: number
  account: GhAccount
  repository_selection: 'all' | 'selected'
  suspended_at?: string | null
}

export interface GhRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  default_branch?: string
  html_url: string
  description?: string | null
}

export interface GhPull {
  number: number
  title: string
  body: string | null
  html_url: string
  state: 'open' | 'closed'
  draft?: boolean
  merged?: boolean
  merged_at: string | null
  merge_commit_sha?: string | null
  user: { login: string } | null
  head: { ref: string; sha: string }
}

export interface GhManifestConversion {
  id: number
  slug: string
  name: string
  html_url: string
  owner: { login: string }
  client_id: string
  client_secret: string
  pem: string
  webhook_secret: string
}

// -----------------------------------------------------------------------------
// The app itself
// -----------------------------------------------------------------------------

/** Stores the app GitHub created from our manifest, sealing its secrets. */
export async function saveManifestApp(app: GhManifestConversion) {
  const data = {
    appId: app.id,
    slug: app.slug,
    name: app.name,
    ownerLogin: app.owner.login,
    htmlUrl: app.html_url,
    clientId: app.client_id,
    clientSecretEnc: seal(app.client_secret),
    privateKeyEnc: seal(app.pem),
    webhookSecretEnc: seal(app.webhook_secret),
  }
  return prisma.githubApp.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data })
}

/**
 * Points the app's webhook at a new URL — a new tunnel in development, or the
 * production domain once deployed — without a trip to GitHub's settings.
 */
export async function updateWebhookUrl(url: string | null) {
  await asApp('/app/hook/config', {
    method: 'PATCH',
    body: { url: url ?? 'https://example.invalid/webhook-disabled', content_type: 'json' },
  })
}

export async function getWebhookUrl(): Promise<string | null> {
  const config = await asApp<{ url?: string }>('/app/hook/config')
  return config.url && !config.url.includes('example.invalid') ? config.url : null
}

// -----------------------------------------------------------------------------
// Installations and repositories
// -----------------------------------------------------------------------------

/**
 * Mirrors one installation and every repository it grants.
 *
 * Repositories that have dropped out of the grant are marked inaccessible, not
 * deleted, so tickets that point at them keep their history.
 */
export async function syncInstallation(installationId: number | bigint) {
  const installation = await asApp<GhInstallation>(`/app/installations/${installationId}`)
  const row = await upsertInstallation(installation)

  const repos: GhRepo[] = []
  for (let page = 1; page <= 20; page++) {
    const result = await asInstallation<{ total_count: number; repositories: GhRepo[] }>(
      installationId,
      `/installation/repositories?per_page=100&page=${page}`,
    )
    repos.push(...result.repositories)
    if (repos.length >= result.total_count || result.repositories.length === 0) break
  }

  for (const repo of repos) await upsertRepo(row.id, repo)

  await prisma.githubRepo.updateMany({
    where: { installationId: row.id, githubId: { notIn: repos.map((r) => BigInt(r.id)) } },
    data: { isAccessible: false },
  })

  return { installation: row, repoCount: repos.length }
}

/** Every installation of the app, in case one arrived while nothing listened. */
export async function syncAllInstallations() {
  const installations = await asApp<GhInstallation[]>('/app/installations?per_page=100')
  let repoCount = 0
  for (const installation of installations) {
    repoCount += (await syncInstallation(installation.id)).repoCount
  }

  // Anything we hold that GitHub no longer lists has been uninstalled.
  await prisma.githubInstallation.updateMany({
    where: {
      installationId: { notIn: installations.map((i) => BigInt(i.id)) },
      removedAt: null,
    },
    data: { removedAt: new Date() },
  })

  return { installations: installations.length, repos: repoCount }
}

async function upsertInstallation(installation: GhInstallation) {
  const data = {
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    avatarUrl: installation.account.avatar_url ?? null,
    repositorySelection: installation.repository_selection,
    suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    removedAt: null,
  }
  return prisma.githubInstallation.upsert({
    where: { installationId: BigInt(installation.id) },
    create: { installationId: BigInt(installation.id), ...data },
    update: data,
  })
}

async function upsertRepo(installationRowId: string, repo: GhRepo) {
  const data = {
    installationId: installationRowId,
    fullName: repo.full_name,
    name: repo.name,
    ownerLogin: repo.owner.login,
    isPrivate: repo.private,
    defaultBranch: repo.default_branch ?? 'main',
    htmlUrl: repo.html_url,
    description: repo.description ?? null,
    isAccessible: true,
  }
  return prisma.githubRepo.upsert({
    where: { githubId: BigInt(repo.id) },
    create: { githubId: BigInt(repo.id), ...data },
    update: data,
  })
}

async function markInstallationRemoved(installationId: number) {
  const row = await prisma.githubInstallation.findUnique({
    where: { installationId: BigInt(installationId) },
    select: { id: true },
  })
  if (!row) return
  await prisma.$transaction([
    prisma.githubInstallation.update({ where: { id: row.id }, data: { removedAt: new Date() } }),
    prisma.githubRepo.updateMany({ where: { installationId: row.id }, data: { isAccessible: false } }),
  ])
}

// -----------------------------------------------------------------------------
// Recording a development artefact against tickets
// -----------------------------------------------------------------------------

type RepoRow = { id: string; fullName: string; htmlUrl: string }

interface RefInput {
  kind: GitRefKind
  externalId: string
  title: string
  url: string
  state: GitRefState | null
  checkState?: GitCheckState | null
  authorLogin?: string | null
  headSha?: string | null
  headBranch?: string | null
  mergedAt?: Date | null
  mergeCommitSha?: string | null
}

/** Project codes of every project this repository is linked to. */
async function linkedCodes(repoId: string): Promise<Set<string>> {
  const links = await prisma.projectRepo.findMany({
    where: { repoId },
    select: { project: { select: { code: true } } },
  })
  return new Set(links.map((link) => link.project.code))
}

function describeRef(ref: RefInput, repo: RepoRow): string {
  switch (ref.kind) {
    case 'PULL_REQUEST':
      return `pull request #${ref.externalId} in ${repo.fullName}`
    case 'BRANCH':
      return `branch ${ref.externalId} in ${repo.fullName}`
    case 'COMMIT':
      return `commit ${ref.externalId.slice(0, 7)} in ${repo.fullName}`
  }
}

/**
 * Records `ref` against every ticket among `keys` that belongs to a project
 * this repository is linked to, then applies status automation.
 *
 * Automation only fires when the artefact is new or its state has changed. A
 * pull request being edited says nothing new, and re-applying its state on
 * every edit would undo a person who had deliberately moved the ticket back.
 */
async function recordRef(
  repo: RepoRow,
  keys: string[],
  ref: RefInput,
  event: GitEvent | null,
): Promise<string[]> {
  if (keys.length === 0) return []

  const tickets = await prisma.ticket.findMany({
    where: { key: { in: keys }, project: { repos: { some: { repoId: repo.id } } } },
    select: {
      id: true,
      key: true,
      projectId: true,
      completedAt: true,
      status: { select: { name: true, category: true } },
      project: { select: { settings: { select: { githubAutomation: true } } } },
    },
  })

  const touched: string[] = []

  for (const ticket of tickets) {
    await prisma.$transaction(async (tx) => {
      const where = {
        ticketId_repoId_kind_externalId: {
          ticketId: ticket.id,
          repoId: repo.id,
          kind: ref.kind,
          externalId: ref.externalId,
        },
      }
      const existing = await tx.ticketGitRef.findUnique({ where, select: { state: true } })

      await tx.ticketGitRef.upsert({
        where,
        create: {
          ticketId: ticket.id,
          repoId: repo.id,
          kind: ref.kind,
          externalId: ref.externalId,
          title: ref.title,
          url: ref.url,
          state: ref.state,
          checkState: ref.checkState ?? null,
          authorLogin: ref.authorLogin ?? null,
          headSha: ref.headSha ?? null,
          headBranch: ref.headBranch ?? null,
          mergedAt: ref.mergedAt ?? null,
          mergeCommitSha: ref.mergeCommitSha ?? null,
        },
        update: {
          title: ref.title,
          url: ref.url,
          state: ref.state,
          // Undefined leaves the stored check result alone; null clears it.
          checkState: ref.checkState,
          authorLogin: ref.authorLogin ?? undefined,
          headSha: ref.headSha ?? undefined,
          headBranch: ref.headBranch ?? undefined,
          mergedAt: ref.mergedAt ?? undefined,
          mergeCommitSha: ref.mergeCommitSha ?? undefined,
        },
      })

      const isNew = existing === null
      const stateChanged = !isNew && existing.state !== ref.state
      if (!isNew && !stateChanged) return

      touched.push(ticket.key)

      const base = {
        entityType: 'INTEGRATION' as const,
        entityId: ticket.id,
        entityLabel: ticket.key,
        projectId: ticket.projectId,
        ticketId: ticket.id,
        actorId: null,
      }
      const by = ref.authorLogin ? ` by @${ref.authorLogin}` : ''

      if (isNew) {
        await recordActivity(tx, {
          ...base,
          action: 'RESOURCE_ADDED',
          summary: `linked ${describeRef(ref, repo)}${by}`,
        })
      } else if (ref.state) {
        await recordActivity(tx, {
          ...base,
          action: 'UPDATED',
          summary: `saw ${describeRef(ref, repo)} ${
            // A branch has no "closed"; it was deleted.
            ref.kind === 'BRANCH' && ref.state === 'CLOSED' ? 'deleted' : ref.state.toLowerCase()
          }`,
        })
      }

      // --- status automation ------------------------------------------------
      if (!event || ticket.project.settings?.githubAutomation === false) return

      const target = targetCategoryFor(event)
      if (!target || !mayAdvance(ticket.status.category, target)) return

      // The first status of that category on the board — the one a person
      // dragging the card forward would reach first.
      const status = await tx.status.findFirst({
        where: { projectId: ticket.projectId, category: target },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, category: true },
      })
      if (!status) return

      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          statusId: status.id,
          completedAt: isTerminal(status.category) ? (ticket.completedAt ?? new Date()) : null,
        },
      })
      await recordActivity(tx, {
        ...base,
        action: 'STATUS_CHANGED',
        field: 'status',
        oldValue: ticket.status.name,
        newValue: status.name,
        summary: `moved ${ticket.key} to ${status.name} — ${describeRef(ref, repo)} is ${
          ref.state ? ref.state.toLowerCase() : 'new'
        }`,
      })
    })
  }

  return touched
}

function pullState(pull: GhPull): GitRefState {
  if (pull.merged || pull.merged_at) return 'MERGED'
  if (pull.state === 'closed') return 'CLOSED'
  return pull.draft ? 'DRAFT' : 'OPEN'
}

function pullRef(pull: GhPull, checkState?: GitCheckState | null): RefInput {
  return {
    kind: 'PULL_REQUEST',
    externalId: String(pull.number),
    title: pull.title,
    url: pull.html_url,
    state: pullState(pull),
    checkState,
    authorLogin: pull.user?.login ?? null,
    headSha: pull.head.sha,
    headBranch: pull.head.ref,
    mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
    // GitHub fills this in for open pull requests too (a test merge); only a
    // merged one's is a commit that exists on the base branch.
    mergeCommitSha: pull.merged_at ? (pull.merge_commit_sha ?? null) : null,
  }
}

function branchRef(repo: RepoRow, name: string, state: GitRefState = 'OPEN'): RefInput {
  return {
    kind: 'BRANCH',
    externalId: name,
    title: name,
    url: `${repo.htmlUrl}/tree/${name.split('/').map(encodeURIComponent).join('/')}`,
    state,
  }
}

/** GitHub check conclusions, rolled into the three states the UI shows. */
export function toCheckState(status: string | null, conclusion: string | null): GitCheckState | null {
  if (status && status !== 'completed') return 'PENDING'
  switch (conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'SUCCESS'
    case 'failure':
    case 'timed_out':
    case 'cancelled':
    case 'action_required':
    case 'startup_failure':
      return 'FAILURE'
    default:
      return null
  }
}

// -----------------------------------------------------------------------------
// Webhooks
// -----------------------------------------------------------------------------

/** Finds our row for the repository in a payload, creating it if it is new. */
async function repoFromPayload(payload: {
  repository?: GhRepo
  installation?: { id: number }
}): Promise<RepoRow | null> {
  if (!payload.repository) return null

  const known = await prisma.githubRepo.findUnique({
    where: { githubId: BigInt(payload.repository.id) },
    select: { id: true, fullName: true, htmlUrl: true },
  })
  if (known) return known

  // A repository we have not mirrored yet — typically one created a moment ago
  // under an "all repositories" grant. Mirror the installation and retry.
  if (!payload.installation) return null
  await syncInstallation(payload.installation.id)
  return prisma.githubRepo.findUnique({
    where: { githubId: BigInt(payload.repository.id) },
    select: { id: true, fullName: true, htmlUrl: true },
  })
}

export interface WebhookOutcome {
  handled: boolean
  tickets: string[]
  note?: string
}

/**
 * Dispatches one verified webhook delivery. Events nobody asked for are
 * acknowledged and ignored: GitHub retries non-2xx responses, and an event we
 * do not handle is not an error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleWebhook(event: string, payload: any): Promise<WebhookOutcome> {
  switch (event) {
    case 'ping':
      return { handled: true, tickets: [], note: 'pong' }

    case 'installation': {
      if (payload.action === 'deleted') {
        await markInstallationRemoved(payload.installation.id)
      } else {
        await syncInstallation(payload.installation.id)
      }
      return { handled: true, tickets: [] }
    }

    case 'installation_repositories':
      await syncInstallation(payload.installation.id)
      return { handled: true, tickets: [] }

    case 'repository': {
      if (!payload.installation || !payload.repository) return { handled: false, tickets: [] }
      const installation = await prisma.githubInstallation.findUnique({
        where: { installationId: BigInt(payload.installation.id) },
        select: { id: true },
      })
      if (installation) await upsertRepo(installation.id, payload.repository)
      return { handled: true, tickets: [] }
    }

    case 'create': {
      if (payload.ref_type !== 'branch') return { handled: false, tickets: [] }
      const repo = await repoFromPayload(payload)
      if (!repo) return { handled: false, tickets: [] }
      const keys = extractTicketKeys([payload.ref], await linkedCodes(repo.id))
      const tickets = await recordRef(repo, keys, branchRef(repo, payload.ref), {
        kind: 'branch_created',
      })
      return { handled: true, tickets }
    }

    case 'delete': {
      if (payload.ref_type !== 'branch') return { handled: false, tickets: [] }
      const repo = await repoFromPayload(payload)
      if (!repo) return { handled: false, tickets: [] }
      const keys = extractTicketKeys([payload.ref], await linkedCodes(repo.id))
      const tickets = await recordRef(repo, keys, branchRef(repo, payload.ref, 'CLOSED'), null)
      return { handled: true, tickets }
    }

    case 'push': {
      if (payload.deleted || !String(payload.ref).startsWith('refs/heads/')) {
        return { handled: false, tickets: [] }
      }
      const repo = await repoFromPayload(payload)
      if (!repo) return { handled: false, tickets: [] }

      const codes = await linkedCodes(repo.id)
      const branch = String(payload.ref).slice('refs/heads/'.length)
      const touched = new Set<string>()

      // A push that creates a branch also sends a `create` event; handling it
      // here too means a missed `create` still records the branch.
      if (payload.created) {
        const keys = extractTicketKeys([branch], codes)
        for (const key of await recordRef(repo, keys, branchRef(repo, branch), {
          kind: 'branch_created',
        })) {
          touched.add(key)
        }
      }

      for (const commit of (payload.commits ?? []) as Array<{
        id: string
        message: string
        url: string
        distinct?: boolean
        author?: { username?: string }
      }>) {
        // Non-distinct commits already arrived on another branch.
        if (commit.distinct === false) continue
        const keys = extractTicketKeys([commit.message], codes)
        const tickets = await recordRef(
          repo,
          keys,
          {
            kind: 'COMMIT',
            externalId: commit.id,
            title: commit.message.split('\n')[0].slice(0, 200),
            url: commit.url,
            state: null,
            authorLogin: commit.author?.username ?? null,
          },
          null,
        )
        for (const key of tickets) touched.add(key)
      }

      return { handled: true, tickets: [...touched] }
    }

    case 'pull_request': {
      const repo = await repoFromPayload(payload)
      if (!repo) return { handled: false, tickets: [] }
      const pull = payload.pull_request as GhPull
      const keys = extractTicketKeys(
        [pull.title, pull.body, pull.head.ref],
        await linkedCodes(repo.id),
      )
      // A new head commit invalidates the previous CI result.
      const checkState = payload.action === 'synchronize' ? null : undefined
      const ref = pullRef(pull, checkState)
      const tickets = await recordRef(repo, keys, ref, {
        kind: 'pull_request',
        state: ref.state!,
      })
      return { handled: true, tickets }
    }

    case 'deployment_status': {
      const repo = await repoFromPayload(payload)
      if (!repo) return { handled: false, tickets: [] }
      const full = await prisma.githubRepo.findUniqueOrThrow({
        where: { id: repo.id },
        select: { id: true, fullName: true, defaultBranch: true, installation: { select: { installationId: true } } },
      })
      const { recordDeployment } = await import('./deployments')
      const result = await recordDeployment(full, payload.deployment, payload.deployment_status)
      return { handled: true, tickets: result.tickets }
    }

    case 'check_suite': {
      const repo = await repoFromPayload(payload)
      if (!repo) return { handled: false, tickets: [] }
      const suite = payload.check_suite as {
        head_sha: string
        status: string | null
        conclusion: string | null
      }
      const checkState = toCheckState(suite.status, suite.conclusion)
      const updated = await prisma.ticketGitRef.updateMany({
        where: { repoId: repo.id, kind: 'PULL_REQUEST', headSha: suite.head_sha },
        data: { checkState },
      })
      if (checkState === 'FAILURE') {
        const prNumbers = ((payload.check_suite.pull_requests ?? []) as Array<{ number: number }>).map((pr) => pr.number)
        if (prNumbers.length > 0) {
          const { maybeAutoHeal } = await import('@/features/ai-fix/auto-heal')
          await maybeAutoHeal(repo.id, prNumbers)
        }
      }
      return { handled: true, tickets: [], note: `${updated.count} pull request refs` }
    }

    default:
      return { handled: false, tickets: [] }
  }
}

// -----------------------------------------------------------------------------
// Reconciliation
// -----------------------------------------------------------------------------

/**
 * Brings one linked repository up to date by asking GitHub directly.
 *
 * What makes the integration work without a public webhook URL — local
 * development, a deployment behind a firewall — and what recovers from any
 * delivery that was missed. Bounded to recent activity: the fifty most
 * recently updated pull requests, the first hundred branches and the last
 * fifty commits on the default branch.
 */
export async function reconcileRepo(repoId: string) {
  const repo = await prisma.githubRepo.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      fullName: true,
      htmlUrl: true,
      defaultBranch: true,
      isAccessible: true,
      installation: { select: { installationId: true } },
    },
  })
  if (!repo || !repo.isAccessible) return { tickets: [] as string[] }

  const codes = await linkedCodes(repo.id)
  if (codes.size === 0) return { tickets: [] as string[] }

  const installationId = repo.installation.installationId
  const path = `/repos/${repo.fullName}`
  const touched = new Set<string>()
  const add = (keys: string[]) => keys.forEach((key) => touched.add(key))

  // --- branches ---------------------------------------------------------------
  const branches = await asInstallation<Array<{ name: string }>>(
    installationId,
    `${path}/branches?per_page=100`,
  )
  const liveBranches = new Set(branches.map((branch) => branch.name))
  for (const branch of branches) {
    const keys = extractTicketKeys([branch.name], codes)
    add(await recordRef(repo, keys, branchRef(repo, branch.name), { kind: 'branch_created' }))
  }

  // A branch we recorded as open that GitHub no longer has was deleted.
  const stale = await prisma.ticketGitRef.findMany({
    where: { repoId: repo.id, kind: 'BRANCH', state: 'OPEN' },
    select: { externalId: true, ticket: { select: { key: true } } },
  })
  for (const ref of stale) {
    if (liveBranches.has(ref.externalId)) continue
    add(await recordRef(repo, [ref.ticket.key], branchRef(repo, ref.externalId, 'CLOSED'), null))
  }

  // --- pull requests ----------------------------------------------------------
  const pulls = await asInstallation<GhPull[]>(
    installationId,
    `${path}/pulls?state=all&sort=updated&direction=desc&per_page=50`,
  )
  for (const pull of pulls) {
    const keys = extractTicketKeys([pull.title, pull.body, pull.head.ref], codes)
    if (keys.length === 0) continue

    // Only open pull requests are worth a second request for CI state.
    let checkState: GitCheckState | null | undefined
    if (pull.state === 'open') {
      const suites = await asInstallation<{
        check_suites: Array<{ status: string | null; conclusion: string | null }>
      }>(installationId, `${path}/commits/${pull.head.sha}/check-suites`).catch(() => null)
      checkState = rollupChecks(suites?.check_suites ?? [])
    }

    const ref = pullRef(pull, checkState)
    add(await recordRef(repo, keys, ref, { kind: 'pull_request', state: ref.state! }))
  }

  // --- deployments ---------------------------------------------------------------
  const { reconcileDeployments } = await import('./deployments')
  const full = await prisma.githubRepo.findUniqueOrThrow({
    where: { id: repo.id },
    select: { id: true, fullName: true, defaultBranch: true, installation: { select: { installationId: true } } },
  })
  add(await reconcileDeployments(full))

  // --- commits on the default branch ------------------------------------------
  const commits = await asInstallation<
    Array<{ sha: string; html_url: string; commit: { message: string }; author: { login: string } | null }>
  >(installationId, `${path}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=50`).catch(
    // An empty repository has no commits and answers 409.
    () => [],
  )
  for (const commit of commits) {
    const keys = extractTicketKeys([commit.commit.message], codes)
    add(
      await recordRef(
        repo,
        keys,
        {
          kind: 'COMMIT',
          externalId: commit.sha,
          title: commit.commit.message.split('\n')[0].slice(0, 200),
          url: commit.html_url,
          state: null,
          authorLogin: commit.author?.login ?? null,
        },
        null,
      ),
    )
  }

  return { tickets: [...touched] }
}

/**
 * Several check suites (one per app that runs CI) roll up to one state: any
 * failure fails, anything still running is pending, and only all-green is
 * success. No suites at all means no CI, which is not the same as passing.
 */
export function rollupChecks(
  suites: ReadonlyArray<{ status: string | null; conclusion: string | null }>,
): GitCheckState | null {
  const states = suites.map((suite) => toCheckState(suite.status, suite.conclusion))
  if (states.includes('FAILURE')) return 'FAILURE'
  if (states.includes('PENDING')) return 'PENDING'
  if (states.includes('SUCCESS')) return 'SUCCESS'
  return null
}

/** Reconciles every repository linked to any project. For the cron sweep. */
export async function reconcileAllLinked(limit = 25) {
  const repos = await prisma.githubRepo.findMany({
    where: { isAccessible: true, projects: { some: {} } },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })
  let tickets = 0
  for (const repo of repos) {
    tickets += (await reconcileRepo(repo.id)).tickets.length
  }
  return { repos: repos.length, tickets }
}
