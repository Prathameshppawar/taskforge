import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { syncInstallation } from './service'
import { userAccessToken } from './user-auth'

/**
 * Creates a repository as the person asking, and makes it one the app can
 * work in.
 *
 * Under their own account it is created with their token (an app cannot
 * create one there); under an organisation, the same, as a member. `auto_init`
 * gives it a first commit and a default branch, which the scaffold run needs
 * to branch from. If the app's install on that account covers only selected
 * repositories, the new one is added to it, so TaskForge can see it at once.
 */
export async function createRepository(input: {
  actorId: string
  owner: string
  name: string
  description: string | null
  isPrivate: boolean
  projectId: string
}) {
  const auth = await userAccessToken(input.actorId)
  if (!auth) throw new Error('Connect your GitHub account first (Settings → GitHub).')

  const call = async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    const response = await fetch(`https://api.github.com${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TaskForge',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string; errors?: Array<{ message?: string }> }
      const detail = body.errors?.map((error) => error.message).filter(Boolean).join('; ') || body.message || response.statusText
      if (response.status === 403) {
        throw new Error(`GitHub refused (${detail}). The TaskForge app needs the Administration permission (Read and write) to create repositories — add it in the app's settings and accept it on the installation.`)
      }
      throw new Error(`GitHub ${response.status}: ${detail}`)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  const installation = await prisma.githubInstallation.findFirst({
    where: { accountLogin: { equals: input.owner, mode: 'insensitive' }, removedAt: null },
    select: { installationId: true, repositorySelection: true },
  })
  if (!installation) throw new Error(`The TaskForge app is not installed on ${input.owner}, so it could not work in a repository there.`)

  const body = { name: input.name, description: input.description ?? undefined, private: input.isPrivate, auto_init: true }
  const repo =
    input.owner.toLowerCase() === auth.login.toLowerCase()
      ? await call<{ id: number; full_name: string; html_url: string }>('/user/repos', { method: 'POST', body })
      : await call<{ id: number; full_name: string; html_url: string }>(`/orgs/${encodeURIComponent(input.owner)}/repos`, { method: 'POST', body })

  if (installation.repositorySelection === 'selected') {
    await call(`/user/installations/${installation.installationId}/repositories/${repo.id}`, { method: 'PUT' })
  }

  await syncInstallation(installation.installationId)
  const row = await prisma.githubRepo.findUnique({ where: { githubId: BigInt(repo.id) }, select: { id: true, fullName: true } })
  if (!row) throw new Error('The repository was created, but the app cannot see it yet. Press Refresh on Integrations.')

  await prisma.projectRepo.upsert({
    where: { projectId_repoId: { projectId: input.projectId, repoId: row.id } },
    create: { projectId: input.projectId, repoId: row.id },
    update: {},
  })
  await recordActivity(prisma, {
    action: 'CREATED',
    entityType: 'INTEGRATION',
    entityId: row.id,
    entityLabel: row.fullName,
    projectId: input.projectId,
    actorId: input.actorId,
    summary: `created the repository ${row.fullName} and linked it`,
  })
  return { repoId: row.id, fullName: row.fullName, url: repo.html_url }
}
