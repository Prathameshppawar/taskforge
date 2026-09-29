'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { botToken, saveTeamsCredentials, teamsCredentials } from '@/infrastructure/msteams/client'
import { recordActivity } from '@/features/activity/service'
import { requirePermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Connecting the bot: its app registration's id, client secret and tenant, checked with Microsoft before they are kept. */
export async function saveTeamsAction(input: { appId: string; password?: string; tenantId?: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z
      .object({
        appId: z.string().trim().regex(GUID, 'The App ID is a GUID, like 1a2b3c4d-….'),
        password: z.string().trim().max(200).optional(),
        tenantId: z.string().trim().regex(GUID, 'The tenant ID is a GUID.').optional().or(z.literal('')),
      })
      .parse(input)
    const actor = await requirePermission('integration:manage')

    const previous = await teamsCredentials()
    const password = data.password || (previous?.appId === data.appId ? previous.password : '')
    if (!password) return fail('Enter the bot’s client secret.')
    try {
      await botToken({ appId: data.appId, password, tenantId: data.tenantId || null })
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Microsoft refused those credentials.')
    }

    await saveTeamsCredentials({ appId: data.appId, password, tenantId: data.tenantId || null })
    await recordActivity(prisma, {
      action: 'ACTIVATED',
      entityType: 'INTEGRATION',
      entityId: 'msteams',
      entityLabel: 'Microsoft Teams',
      actorId: actor.id,
      summary: 'connected the Microsoft Teams bot',
    })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}

export async function disconnectTeamsAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('integration:manage')
    await saveTeamsCredentials(null)
    await recordActivity(prisma, {
      action: 'DEACTIVATED',
      entityType: 'INTEGRATION',
      entityId: 'msteams',
      entityLabel: 'Microsoft Teams',
      actorId: actor.id,
      summary: 'disconnected the Microsoft Teams bot',
    })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}
