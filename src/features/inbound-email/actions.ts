'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requirePermission, requireProjectPermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { isInboundConfigured, pollMailbox, type PollResult } from './service'

/** Turning email in on and off: for the workspace, and per project. */

export async function updateInboundSettingAction(input: { enabled: boolean; structureWithAi: boolean }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ enabled: z.boolean(), structureWithAi: z.boolean() }).parse(input)
    const actor = await requirePermission('integration:manage')
    if (data.enabled && !isInboundConfigured()) {
      return fail('Email is not configured: set EMAIL_HOST, EMAIL_USER and EMAIL_PASS (and IMAP_HOST if IMAP is not beside SMTP).')
    }
    await prisma.inboundEmailSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data })
    await recordActivity(prisma, {
      action: data.enabled ? 'ACTIVATED' : 'DEACTIVATED',
      entityType: 'INTEGRATION',
      entityId: 'inbound-email',
      entityLabel: 'Email in',
      actorId: actor.id,
      summary: `${data.enabled ? 'turned on' : 'turned off'} email in${data.enabled && data.structureWithAi ? ', structured by the Copilot' : ''}`,
    })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}

export async function checkMailboxNowAction(): Promise<ActionResult<PollResult>> {
  return runAction(async () => {
    await requirePermission('integration:manage')
    try {
      const result = await pollMailbox()
      revalidatePath('/workspace/integrations')
      return ok(result)
    } catch (error) {
      return fail(`The mailbox could not be read: ${error instanceof Error ? error.message : 'unknown error'}. For Gmail, IMAP needs an app password.`)
    }
  })
}

export async function setProjectEmailIntakeAction(input: { projectId: string; enabled: boolean }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ projectId: z.string().min(1), enabled: z.boolean() }).parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    await prisma.$transaction(async (tx) => {
      await tx.projectSettings.update({ where: { projectId: data.projectId }, data: { emailIntake: data.enabled } })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'PROJECT',
        entityId: data.projectId,
        projectId: data.projectId,
        actorId: actor.id,
        summary: data.enabled ? 'started taking tickets by email' : 'stopped taking tickets by email',
      })
    })
    revalidatePath(`/projects/${data.projectId}/settings`)
    return ok()
  })
}
