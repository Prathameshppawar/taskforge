'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requirePermission, requireProjectPermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { isPublicUrl } from './manifest'
import { reconcileRepo, syncAllInstallations, updateWebhookUrl } from './service'

/**
 * GitHub actions.
 *
 * Workspace-level ones — the app, its installs, the webhook — need
 * `integration:manage`. Linking a repository to a project is configuring that
 * project's board, so it needs what editing statuses needs:
 * `project:manage-config` in that project.
 */

// -----------------------------------------------------------------------------
// Workspace
// -----------------------------------------------------------------------------

export async function refreshGithubAction(): Promise<
  ActionResult<{ installations: number; repos: number }>
> {
  return runAction(async () => {
    await requirePermission('integration:manage')
    const result = await syncAllInstallations()
    revalidatePath('/workspace/integrations')
    return ok(result)
  })
}

const webhookSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter a full URL.')
    .refine(isPublicUrl, 'GitHub can only reach a public https:// address.')
    .nullable(),
})

export async function setWebhookUrlAction(input: {
  url: string | null
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('integration:manage')
    const { url } = webhookSchema.parse(input)
    // Accept the base address or the full path; register the full path.
    const target = url ? url.replace(/\/+$/, '').replace(/(\/api\/github\/webhook)?$/, '/api/github/webhook') : null
    await updateWebhookUrl(target)
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'INTEGRATION',
      entityId: 'github-webhook',
      entityLabel: 'GitHub webhook',
      actorId: actor.id,
      summary: target ? `pointed the GitHub webhook at ${target}` : 'switched the GitHub webhook off',
    })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}

/**
 * Forgets the stored app. The app itself stays on GitHub — deleting it there is
 * the account owner's call, and is one click in their settings.
 */
export async function forgetGithubAppAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('integration:manage')
    const app = await prisma.githubApp.findUnique({ where: { id: 1 }, select: { name: true } })
    if (!app) throw new NotFoundError('GitHub App', '1')

    await prisma.$transaction(async (tx) => {
      await tx.githubApp.delete({ where: { id: 1 } })
      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'INTEGRATION',
        entityId: 'github-app',
        entityLabel: app.name,
        actorId: actor.id,
        summary: `disconnected the GitHub App "${app.name}"`,
      })
    })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}

// -----------------------------------------------------------------------------
// Projects
// -----------------------------------------------------------------------------

const linkSchema = z.object({
  projectId: z.string().min(1),
  repoId: z.string().min(1),
  role: z.string().trim().max(40).nullable().optional(),
})

export async function linkRepoAction(
  input: z.infer<typeof linkSchema>,
): Promise<ActionResult<{ tickets: number }>> {
  return runAction(async () => {
    const data = linkSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const repo = await prisma.githubRepo.findUnique({
      where: { id: data.repoId },
      select: { id: true, fullName: true, isAccessible: true },
    })
    if (!repo) throw new NotFoundError('Repository', data.repoId)
    if (!repo.isAccessible) {
      throw new BusinessRuleError('The GitHub App no longer has access to that repository.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectRepo.create({
        data: { projectId: data.projectId, repoId: repo.id, role: data.role || null },
      })
      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'INTEGRATION',
        entityId: repo.id,
        entityLabel: repo.fullName,
        projectId: data.projectId,
        actorId: actor.id,
        summary: `linked the repository ${repo.fullName}`,
      })
    })

    // Pick up whatever already mentions this project's tickets, so linking a
    // repository with history is immediately useful. Failure here is not a
    // failure to link — the next sync will catch up.
    const { tickets } = await reconcileRepo(repo.id).catch((error) => {
      console.error('[github] initial reconcile failed:', error)
      return { tickets: [] as string[] }
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok({ tickets: tickets.length })
  })
}

export async function unlinkRepoAction(input: {
  projectId: string
  repoId: string
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = linkSchema.pick({ projectId: true, repoId: true }).parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const link = await prisma.projectRepo.findUnique({
      where: { projectId_repoId: data },
      select: { repo: { select: { fullName: true } } },
    })
    if (!link) throw new NotFoundError('Repository link', data.repoId)

    await prisma.$transaction(async (tx) => {
      await tx.projectRepo.delete({ where: { projectId_repoId: data } })
      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'INTEGRATION',
        entityId: data.repoId,
        entityLabel: link.repo.fullName,
        projectId: data.projectId,
        actorId: actor.id,
        // Existing refs on tickets are kept: they are history, and the work
        // really did happen in that repository.
        summary: `unlinked the repository ${link.repo.fullName}`,
      })
    })

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

export async function setRepoRoleAction(
  input: z.infer<typeof linkSchema>,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = linkSchema.parse(input)
    await requireProjectPermission(data.projectId, 'project:manage-config')
    await prisma.projectRepo.update({
      where: { projectId_repoId: { projectId: data.projectId, repoId: data.repoId } },
      data: { role: data.role || null },
    })
    revalidatePath(`/projects/${data.projectId}/settings`)
    return ok()
  })
}

export async function setGithubAutomationAction(input: {
  projectId: string
  enabled: boolean
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ projectId: z.string().min(1), enabled: z.boolean() }).parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    await prisma.$transaction(async (tx) => {
      await tx.projectSettings.update({
        where: { projectId: data.projectId },
        data: { githubAutomation: data.enabled },
      })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        projectId: data.projectId,
        actorId: actor.id,
        field: 'githubAutomation',
        summary: `${data.enabled ? 'enabled' : 'disabled'} GitHub status automation`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/settings`)
    return ok()
  })
}

/**
 * Lets "Fix with AI" write workflows in this project. A project manager's
 * call, like the rest of the board's configuration — and audited, because it
 * changes what an AI-authored pull request can do the moment it opens.
 */
export async function setAiWorkflowsAction(input: {
  projectId: string
  enabled: boolean
  /** Which switch: workflow writing (default) or automatic CI healing. */
  setting?: 'aiWorkflows' | 'aiAutoHeal'
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z
      .object({ projectId: z.string().min(1), enabled: z.boolean(), setting: z.enum(['aiWorkflows', 'aiAutoHeal']).default('aiWorkflows') })
      .parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    await prisma.$transaction(async (tx) => {
      await tx.projectSettings.update({
        where: { projectId: data.projectId },
        data: { [data.setting]: data.enabled },
      })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        projectId: data.projectId,
        actorId: actor.id,
        field: data.setting,
        summary:
          data.setting === 'aiAutoHeal'
            ? `${data.enabled ? 'enabled' : 'disabled'} automatic fixing of failing CI on AI pull requests`
            : `${data.enabled ? 'allowed' : 'stopped'} Fix with AI ${data.enabled ? 'to write' : 'writing'} CI workflows`,
      })
    })

    revalidatePath(`/projects/${data.projectId}/settings`)
    return ok()
  })
}

/**
 * Asks GitHub for the current state of every repository linked to a project.
 * Anyone who can edit tickets may: it only records what already happened.
 */
export async function syncProjectReposAction(
  projectId: string,
): Promise<ActionResult<{ repos: number; tickets: number }>> {
  return runAction(async () => {
    await requireProjectPermission(projectId, 'ticket:update')

    const links = await prisma.projectRepo.findMany({
      where: { projectId },
      select: { repoId: true },
    })

    const touched = new Set<string>()
    for (const link of links) {
      for (const key of (await reconcileRepo(link.repoId)).tickets) touched.add(key)
    }

    revalidatePath(`/projects/${projectId}`, 'layout')
    for (const key of touched) revalidatePath(`/tickets/${key}`)
    return ok({ repos: links.length, tickets: touched.size })
  })
}
