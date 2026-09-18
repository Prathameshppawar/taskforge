import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'

import { authConfig } from '@/auth.config'
import { prisma } from '@/infrastructure/db/prisma'
import { verifyPassword, fakeVerify } from '@/infrastructure/auth/password'

/**
 * Node-runtime Auth.js instance.
 *
 * Adds the Credentials provider (bcrypt + Prisma) and periodic revalidation of
 * the JWT against the database, so deactivating a user or resetting their
 * password invalidates their existing sessions without waiting for expiry.
 */

/** How often an active token is re-checked against the database. */
const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

/**
 * Brute-force protection.
 *
 * Attempts are counted per account rather than per IP: an internal tool sits
 * behind NAT and a shared office address, so IP counting would lock out a whole
 * floor because one person fat-fingered their password.
 *
 * The lockout is a delay, not a ban — it expires on its own, so an attacker
 * cannot use it to deny a colleague access indefinitely.
 */
const MAX_ATTEMPTS = 8
const LOCKOUT_MINUTES = 15

function lockoutUntil(attempts: number): Date | null {
  if (attempts < MAX_ATTEMPTS) return null
  // Doubles each further failure, capped, so a persistent attacker backs off
  // fast while a forgetful colleague waits minutes rather than hours.
  const over = attempts - MAX_ATTEMPTS
  const minutes = Math.min(LOCKOUT_MINUTES * 2 ** over, 60 * 4)
  return new Date(Date.now() + minutes * 60_000)
}

const credentialsSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) {
          await fakeVerify()
          return null
        }

        const { username, password } = parsed.data

        const user = await prisma.user.findUnique({
          where: { username: username.toLowerCase() },
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            passwordHash: true,
            isActive: true,
            mustChangePassword: true,
            avatarColor: true,
            sessionVersion: true,
            failedLoginAttempts: true,
            lockedUntil: true,
            role: { select: { key: true } },
          },
        })

        // Spend equivalent time on a missing user so timing cannot be used to
        // enumerate valid usernames.
        if (!user) {
          await fakeVerify()
          return null
        }

        // Locked out — still spend the hashing time, so a locked account cannot
        // be distinguished from a wrong password by response timing.
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await fakeVerify()
          return null
        }

        const valid = await verifyPassword(password, user.passwordHash)

        if (!valid) {
          const attempts = user.failedLoginAttempts + 1
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: lockoutUntil(attempts),
            },
          })
          return null
        }

        // Deactivated accounts are rejected at the door.
        if (!user.isActive) return null

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            // A success clears the counter; a locked-out window that has since
            // expired should not leave the next mistake one step from relocking.
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        })

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role.key,
          isActive: user.isActive,
          mustChangePassword: user.mustChangePassword,
          avatarColor: user.avatarColor,
          sessionVersion: user.sessionVersion,
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async jwt(params) {
      // Run the shared edge-safe logic first (sign-in hydration, update trigger).
      const token = authConfig.callbacks.jwt(params)

      // Fresh sign-in already reflects the database.
      if (params.user) return token

      const age = Date.now() - (token.checkedAt ?? 0)
      if (age < REVALIDATE_INTERVAL_MS) return token

      const current = await prisma.user.findUnique({
        where: { id: token.id },
        select: {
          isActive: true,
          sessionVersion: true,
          mustChangePassword: true,
          name: true,
          avatarColor: true,
          role: { select: { key: true } },
        },
      })

      // Deleted, deactivated, or sessions explicitly invalidated by an admin
      // password reset — returning null clears the session.
      if (
        !current ||
        !current.isActive ||
        current.sessionVersion !== token.sessionVersion
      ) {
        return null
      }

      token.role = current.role.key
      token.isActive = current.isActive
      token.mustChangePassword = current.mustChangePassword
      token.name = current.name
      token.avatarColor = current.avatarColor
      token.checkedAt = Date.now()

      return token
    },
  },
})
