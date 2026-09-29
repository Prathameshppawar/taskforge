'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { requireActor } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { AVATAR_MAX_BYTES, sniffImageType } from './avatar'

/**
 * Sets the signed-in person's profile photo. Always their own: a photo is how
 * someone chooses to be seen, so there is no administrative override.
 */
export async function uploadAvatarAction(form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    const file = form.get('file')
    if (!(file instanceof File)) return fail('No image given.')
    if (file.size > AVATAR_MAX_BYTES) return fail('That image is too large. Try a smaller one.')

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.byteLength > AVATAR_MAX_BYTES) return fail('That image is too large. Try a smaller one.')

    const contentType = sniffImageType(bytes)
    if (!contentType) return fail('Use a PNG, JPEG or WebP image.')

    await prisma.$transaction(async (tx) => {
      await tx.userAvatarImage.upsert({
        where: { userId: actor.id },
        create: { userId: actor.id, contentType, content: bytes },
        update: { contentType, content: bytes },
      })
      await tx.user.update({ where: { id: actor.id }, data: { avatarUpdatedAt: new Date() } })
      await recordActivity(tx, {
        action: 'UPDATED',
        entityType: 'USER',
        entityId: actor.id,
        entityLabel: actor.name,
        actorId: actor.id,
        summary: 'changed their profile photo',
      })
    })

    // Every avatar on every page reads the directory in the app layout.
    revalidatePath('/', 'layout')
    return ok()
  })
}

export async function removeAvatarAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()
    await prisma.$transaction([
      prisma.userAvatarImage.deleteMany({ where: { userId: actor.id } }),
      prisma.user.update({ where: { id: actor.id }, data: { avatarUpdatedAt: null } }),
    ])
    revalidatePath('/', 'layout')
    return ok()
  })
}
