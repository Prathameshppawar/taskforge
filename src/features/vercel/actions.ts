'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requirePermission, requireProjectPermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { rollbackTo, saveVercelToken, verifyVercelToken } from './service'

export async function saveVercelTokenAction(input: { token: string | null; teamId: string | null }): Promise<ActionResult<{ username: string | null }>> {
  return runAction(async () => {
    const actor = await requirePermission('integration:manage')
    const data = z.object({ token: z.string().trim().max(200).nullable(), teamId: z.string().trim().max(100).nullable() }).parse(input)
    await saveVercelToken(data.token || null, data.teamId || null)
    let username: string | null = null
    if (data.token) {
      try {
        username = (await verifyVercelToken()).username
      } catch (error) {
        await saveVercelToken(null, null)
        throw new BusinessRuleError(`Vercel rejected that token: ${(error as Error).message}`)
      }
    }
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'INTEGRATION',
      entityId: 'vercel',
      entityLabel: 'Vercel',
      actorId: actor.id,
      summary: data.token ? `connected Vercel as ${username}` : 'disconnected Vercel',
    })
    revalidatePath('/workspace/integrations')
    return ok({ username })
  })
}

/**
 * Rolls production back. A release decision taken in a hurry, so it needs the
 * project's configuration rights, and the UI asks for confirmation first.
 */
export async function rollbackAction(input: { deploymentId: string; ticketKey: string }): Promise<ActionResult<{ sha: string }>> {
  return runAction(async () => {
    const deployment = await prisma.deployment.findUnique({
      where: { id: input.deploymentId },
      select: { repo: { select: { projects: { select: { projectId: true }, take: 1 } } } },
    })
    const projectId = deployment?.repo.projects[0]?.projectId
    if (!projectId) throw new NotFoundError('Deployment', input.deploymentId)
    const { actor } = await requireProjectPermission(projectId, 'project:manage-config')
    try {
      const result = await rollbackTo(input.deploymentId, actor.id)
      revalidatePath(`/tickets/${input.ticketKey}`)
      return ok({ sha: result.sha })
    } catch (error) {
      throw new BusinessRuleError((error as Error).message)
    }
  })
}
