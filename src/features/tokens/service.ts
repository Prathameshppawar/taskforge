import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { prisma } from '@/infrastructure/db/prisma'
import type { Actor } from '@/features/auth/guards'

/**
 * Personal access tokens.
 *
 * Used by non-browser clients — the MCP server, scripts, CI. A token is an
 * alias for its user and carries no permissions of its own, so an agent holding
 * one is bounded by exactly that user's role.
 *
 * Only the SHA-256 is stored. The plaintext is returned once and is
 * unrecoverable, so a database leak yields no usable credentials. SHA-256
 * rather than bcrypt is deliberate here: the token is 32 bytes of CSPRNG
 * output, so it has no entropy to stretch, and a machine client may present it
 * on every call — a slow KDF would be a self-inflicted bottleneck. bcrypt
 * remains correct for passwords, which are low-entropy and human-chosen.
 */

const TOKEN_PREFIX = 'tf_'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, 11),
  }
}

export interface TokenActor extends Actor {
  tokenId: string
  tokenName: string
}

/**
 * Resolves a bearer token to an actor.
 *
 * Returns null for anything invalid — never distinguishes "no such token" from
 * "revoked" or "expired", so the endpoint cannot be used to probe which tokens
 * exist.
 */
export async function authenticateToken(raw: string | null): Promise<TokenActor | null> {
  if (!raw) return null

  const token = raw.replace(/^Bearer\s+/i, '').trim()
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null

  const record = await prisma.accessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      name: true,
      tokenHash: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          name: true,
          avatarColor: true,
          isActive: true,
          mustChangePassword: true,
          role: { select: { key: true } },
        },
      },
    },
  })

  if (!record) return null

  // The unique-index lookup already matched, but compare explicitly in constant
  // time so the code does not rely on the index for its security property.
  const expected = Buffer.from(record.tokenHash, 'utf8')
  const actual = Buffer.from(hashToken(token), 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  if (record.revokedAt) return null
  if (record.expiresAt && record.expiresAt < new Date()) return null
  // A deactivated user's tokens stop working immediately, without needing to be
  // revoked one by one.
  if (!record.user.isActive) return null

  // Best-effort; never block the request on the audit write.
  void prisma.accessToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined)

  return {
    id: record.user.id,
    username: record.user.username,
    name: record.user.name,
    role: record.user.role.key,
    avatarColor: record.user.avatarColor,
    mustChangePassword: record.user.mustChangePassword,
    tokenId: record.id,
    tokenName: record.name,
  }
}
