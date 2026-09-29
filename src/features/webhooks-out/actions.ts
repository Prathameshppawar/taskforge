'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requirePermission } from '@/features/auth/guards'
import { retryFailed } from '@/features/jobs/queue'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { checkMonitorUrl } from '@/core/domain/network'
import { runAction } from '@/lib/safe-action'
import { EVENTS, deliver, newSecret, sealSecret } from './service'

export async function createWebhookAction(input: { name: string; url: string; events: string[]; projectId: string | null }): Promise<ActionResult<{ secret: string }>> {
  return runAction(async () => {
    const data = z
      .object({ name: z.string().trim().min(1).max(60), url: z.string().trim().max(500), events: z.array(z.enum(EVENTS)).min(1), projectId: z.string().nullable() })
      .parse(input)
    const actor = await requirePermission('integration:manage')
    const checked = checkMonitorUrl(data.url)
    if (!checked.ok) return fail(checked.reason)
    const secret = newSecret()
    await prisma.outboundWebhook.create({
      data: { name: data.name, url: checked.url.toString(), events: data.events, projectId: data.projectId, secretEnc: sealSecret(secret), createdById: actor.id },
    })
    await recordActivity(prisma, {
      action: 'CREATED',
      entityType: 'INTEGRATION',
      entityId: 'webhooks',
      entityLabel: 'Webhooks',
      actorId: actor.id,
      summary: `added the webhook ${data.name} (${data.events.join(', ')})`,
    })
    revalidatePath('/workspace/integrations')
    // Shown once: only the sealed form is kept.
    return ok({ secret })
  })
}

export async function setWebhookActiveAction(input: { id: string; active: boolean }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ id: z.string().min(1), active: z.boolean() }).parse(input)
    await requirePermission('integration:manage')
    await prisma.outboundWebhook.update({ where: { id: data.id }, data: { active: data.active } })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}

export async function deleteWebhookAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermission('integration:manage')
    const hook = await prisma.outboundWebhook.delete({ where: { id: z.string().min(1).parse(id) }, select: { name: true } })
    await prisma.job.deleteMany({ where: { kind: 'webhook.deliver', status: { in: ['PENDING', 'FAILED'] }, payload: { path: ['webhookId'], equals: id } } })
    await recordActivity(prisma, { action: 'DELETED', entityType: 'INTEGRATION', entityId: 'webhooks', entityLabel: 'Webhooks', actorId: actor.id, summary: `removed the webhook ${hook.name}` })
    revalidatePath('/workspace/integrations')
    return ok()
  })
}

export async function testWebhookAction(id: string): Promise<ActionResult<{ status: number }>> {
  return runAction(async () => {
    await requirePermission('integration:manage')
    try {
      const status = await deliver(z.string().min(1).parse(id), 'ping', { message: 'A test delivery from TaskForge.' })
      revalidatePath('/workspace/integrations')
      return ok({ status })
    } catch (error) {
      revalidatePath('/workspace/integrations')
      return fail(error instanceof Error ? error.message : 'The delivery failed.')
    }
  })
}

export async function retryJobsAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePermission('integration:manage')
    await retryFailed()
    revalidatePath('/workspace/integrations')
    return ok()
  })
}
