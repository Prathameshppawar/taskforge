'use server'

import { revalidatePath } from 'next/cache'

import { requireActor } from '@/features/auth/guards'
import { ok, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { disconnectGithub } from './user-auth'

export async function disconnectGithubAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    await disconnectGithub(actor.id)
    revalidatePath('/settings/github')
    return ok()
  })
}
