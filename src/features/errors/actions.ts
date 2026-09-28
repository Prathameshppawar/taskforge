'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectPermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { rotateIngestToken } from './service'

/**
 * Issues a new error-ingest URL, invalidating any previous one. The secret is
 * returned once and never stored, like an access token.
 */
export async function rotateErrorIngestAction(projectId: string): Promise<ActionResult<{ token: string }>> {
  return runAction(async () => {
    const { actor } = await requireProjectPermission(projectId, 'project:manage-config')
    const token = await rotateIngestToken(projectId)
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'PROJECT',
      entityId: projectId,
      projectId,
      actorId: actor.id,
      field: 'errorIngest',
      summary: 'issued a new production error intake URL',
    })
    revalidatePath(`/projects/${projectId}/settings`)
    return ok({ token })
  })
}
