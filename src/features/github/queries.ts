import { prisma } from '@/infrastructure/db/prisma'
import { loadCredentials } from '@/infrastructure/github/client'
import { branchNameFor } from '@/core/domain/git-refs'
import { getWebhookUrl } from './service'
import { ticketDeployments } from './deployments'

/**
 * Read models for the three places GitHub shows up: the workspace integrations
 * page, a project's settings, and a ticket.
 *
 * GitHub ids are BigInt in the database and leave here as strings — a BigInt
 * cannot cross into a client component, and nothing in the UI does arithmetic
 * on an id.
 */

export async function getIntegrationOverview() {
  let credentials: Awaited<ReturnType<typeof loadCredentials>> = null
  let credentialError: string | null = null
  try {
    credentials = await loadCredentials()
  } catch {
    // Almost always AUTH_SECRET having changed since the app was stored.
    credentialError =
      'The stored GitHub App could not be unsealed. AUTH_SECRET has probably changed since it was created — forget it and create a new one.'
  }

  const [app, installations] = await Promise.all([
    prisma.githubApp.findUnique({
      where: { id: 1 },
      select: { appId: true, slug: true, name: true, htmlUrl: true, ownerLogin: true, createdAt: true },
    }),
    prisma.githubInstallation.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        installationId: true,
        accountLogin: true,
        accountType: true,
        avatarUrl: true,
        repositorySelection: true,
        suspendedAt: true,
        removedAt: true,
        repos: {
          orderBy: { fullName: 'asc' },
          select: {
            id: true,
            fullName: true,
            isPrivate: true,
            isAccessible: true,
            htmlUrl: true,
            description: true,
            projects: { select: { project: { select: { id: true, name: true, code: true } } } },
          },
        },
      },
    }),
  ])

  // One request to GitHub, only when there is an app to ask about.
  const webhookUrl = credentials ? await getWebhookUrl().catch(() => null) : null

  return {
    configured: Boolean(credentials),
    source: credentials?.source ?? null,
    credentialError,
    app: app ?? (credentials ? { appId: credentials.appId, slug: credentials.slug, name: credentials.slug, htmlUrl: `https://github.com/apps/${credentials.slug}`, ownerLogin: null, createdAt: null } : null),
    webhookUrl,
    installations: installations.map((installation) => ({
      ...installation,
      installationId: installation.installationId.toString(),
      repos: installation.repos.map((repo) => ({
        ...repo,
        projects: repo.projects.map((link) => link.project),
      })),
    })),
  }
}

export type IntegrationOverview = Awaited<ReturnType<typeof getIntegrationOverview>>

/** A project's linked repositories, and every repository it could link. */
export async function getProjectRepos(projectId: string) {
  const [linked, available, settings, app] = await Promise.all([
    prisma.projectRepo.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        repo: {
          select: {
            id: true,
            fullName: true,
            htmlUrl: true,
            isPrivate: true,
            isAccessible: true,
            defaultBranch: true,
          },
        },
      },
    }),
    prisma.githubRepo.findMany({
      where: { isAccessible: true, installation: { removedAt: null, suspendedAt: null } },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, isPrivate: true },
    }),
    prisma.projectSettings.findUnique({
      where: { projectId },
      select: { githubAutomation: true, aiWorkflows: true },
    }),
    prisma.githubApp.findUnique({ where: { id: 1 }, select: { slug: true, ownerLogin: true } }),
  ])

  const linkedIds = new Set(linked.map((link) => link.repo.id))

  return {
    linked: linked.map((link) => ({ ...link.repo, role: link.role })),
    available: available.filter((repo) => !linkedIds.has(repo.id)),
    automation: settings?.githubAutomation ?? true,
    aiWorkflows: settings?.aiWorkflows ?? false,
    /** Where the app's permissions are edited — needed to grant Workflows. */
    appPermissionsUrl: app ? `https://github.com/settings/apps/${app.slug}/permissions` : null,
    hasGithub: available.length > 0 || linked.length > 0,
  }
}

export type ProjectRepos = Awaited<ReturnType<typeof getProjectRepos>>

/** What the ticket page's Development panel shows. */
export async function getTicketDevelopment(ticket: {
  id: string
  key: string
  title: string
  projectId: string
  typeId: string
}) {
  const [refs, repos, type, deployments] = await Promise.all([
    prisma.ticketGitRef.findMany({
      where: { ticketId: ticket.id },
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        kind: true,
        externalId: true,
        title: true,
        url: true,
        state: true,
        checkState: true,
        authorLogin: true,
        headBranch: true,
        mergedAt: true,
        updatedAt: true,
        repo: { select: { fullName: true } },
      },
    }),
    prisma.projectRepo.count({ where: { projectId: ticket.projectId } }),
    prisma.ticketType.findUnique({ where: { id: ticket.typeId }, select: { kind: true } }),
    ticketDeployments(ticket.id),
  ])

  return {
    refs,
    deployments,
    hasRepos: repos > 0,
    branchName: branchNameFor(ticket.key, ticket.title, type?.kind ?? 'TASK'),
  }
}

export type TicketDevelopment = Awaited<ReturnType<typeof getTicketDevelopment>>
