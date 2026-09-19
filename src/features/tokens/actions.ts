'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { requireActor, can } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { ok, type ActionResult } from '@/core/domain/result'
import { ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { generateToken } from './service'

const createTokenSchema = z.object({
  name: z.string().trim().min(1, 'Name this token.').max(60),
  expiresInDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
})
export type CreateTokenInput = z.infer<typeof createTokenSchema>

export async function createTokenAction(
  input: CreateTokenInput,
): Promise<ActionResult<{ token: string; prefix: string }>> {
  return runAction(async () => {
    const actor = await requireActor()
    const data = createTokenSchema.parse(input)

    const { token, hash, prefix } = generateToken()

    await prisma.$transaction(async (tx) => {
      await tx.accessToken.create({
        data: {
          userId: actor.id,
          name: data.name,
          tokenHash: hash,
          prefix,
          expiresAt: data.expiresInDays
            ? new Date(Date.now() + data.expiresInDays * 86_400_000)
            : null,
        },
      })

      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'USER',
        entityId: actor.id,
        entityLabel: actor.name,
        actorId: actor.id,
        summary: `created the access token "${data.name}"`,
      })
    })

    revalidatePath('/settings/tokens')
    // The only time the plaintext ever leaves the server.
    return ok({ token, prefix })
  })
}

export async function revokeTokenAction(tokenId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireActor()

    const token = await prisma.accessToken.findUnique({
      where: { id: tokenId },
      select: { id: true, name: true, userId: true },
    })
    if (!token) throw new NotFoundError('Access token', tokenId)
    if (token.userId !== actor.id && !can(actor, 'user:update')) {
      throw new ForbiddenError('You can only revoke your own tokens.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.accessToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
      })
      await recordActivity(tx, {
        action: 'DELETED',
        entityType: 'USER',
        entityId: token.userId,
        entityLabel: token.name,
        actorId: actor.id,
        summary: `revoked the access token "${token.name}"`,
      })
    })

    revalidatePath('/settings/tokens')
    return ok()
  })
}

export async function listTokensAction() {
  const actor = await requireActor()
  return prisma.accessToken.findMany({
    where: { userId: actor.id },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}
