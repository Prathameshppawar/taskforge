'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectPermission } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, NotFoundError } from '@/core/domain/errors'
import { checkMonitorUrl } from '@/core/domain/network'
import { runAction } from '@/lib/safe-action'
import { runOne } from './service'

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Name it.').max(60),
  url: z.string().trim().min(1),
  expectedStatus: z.coerce.number().int().min(100).max(599).default(200),
  keyword: z.string().trim().max(200).optional(),
  intervalMinutes: z.coerce.number().int().min(5).max(1440).default(5),
})

export async function createMonitorAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ state: string }>> {
  return runAction(async () => {
    const data = createSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    const checked = checkMonitorUrl(data.url)
    if (!checked.ok) throw new BusinessRuleError(checked.reason)
    if ((await prisma.monitor.count({ where: { projectId: data.projectId } })) >= 20) {
      throw new BusinessRuleError('A project can have up to 20 monitors.')
    }

    const monitor = await prisma.monitor.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        url: checked.url.toString(),
        expectedStatus: data.expectedStatus,
        keyword: data.keyword || null,
        intervalMinutes: data.intervalMinutes,
      },
    })
    await recordActivity(prisma, {
      action: 'CREATED',
      entityType: 'PROJECT',
      entityId: data.projectId,
      projectId: data.projectId,
      actorId: actor.id,
      summary: `added the uptime monitor "${data.name}" for ${checked.url.host}`,
    })
    // Checked straight away, so whoever added it sees at once that it works.
    const state = await runOne(monitor.id)
    revalidatePath(`/projects/${data.projectId}/settings`)
    return ok({ state })
  })
}

export async function deleteMonitorAction(input: { projectId: string; monitorId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { actor } = await requireProjectPermission(input.projectId, 'project:manage-config')
    const monitor = await prisma.monitor.findFirst({ where: { id: input.monitorId, projectId: input.projectId } })
    if (!monitor) throw new NotFoundError('Monitor', input.monitorId)
    await prisma.monitor.delete({ where: { id: monitor.id } })
    await recordActivity(prisma, {
      action: 'DELETED',
      entityType: 'PROJECT',
      entityId: input.projectId,
      projectId: input.projectId,
      actorId: actor.id,
      summary: `removed the uptime monitor "${monitor.name}"`,
    })
    revalidatePath(`/projects/${input.projectId}/settings`)
    return ok()
  })
}

export async function checkMonitorNowAction(input: { projectId: string; monitorId: string }): Promise<ActionResult<{ state: string }>> {
  return runAction(async () => {
    await requireProjectPermission(input.projectId, 'project:manage-config')
    const monitor = await prisma.monitor.findFirst({ where: { id: input.monitorId, projectId: input.projectId }, select: { id: true } })
    if (!monitor) throw new NotFoundError('Monitor', input.monitorId)
    const state = await runOne(monitor.id)
    revalidatePath(`/projects/${input.projectId}/settings`)
    return ok({ state })
  })
}
