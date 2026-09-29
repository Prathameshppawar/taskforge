'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectPermission } from '@/features/auth/guards'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { undoTriage } from './service'

export async function undoTriageAction(runId: string): Promise<ActionResult<{ restored: number; kept: string[] }>> {
  return runAction(async () => {
    const run = await prisma.triageRun.findUnique({ where: { id: z.string().min(1).parse(runId) }, select: { ticket: { select: { key: true, projectId: true } } } })
    if (!run) return fail('That triage no longer exists.')
    const { actor } = await requireProjectPermission(run.ticket.projectId, 'ticket:update')
    const result = await undoTriage(runId, actor.id)
    revalidatePath(`/tickets/${run.ticket.key}`)
    return ok(result)
  })
}
