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
            role: { select: { key: true } },
          },
        })

        // Spend equivalent time on a missing user so timing cannot be used to
        // enumerate valid usernames.
        if (!user) {
          await fakeVerify()
          return null
        }

        const valid = await verifyPassword(password, user.passwordHash)
        if (!valid) return null

        // Deactivated accounts are rejected at the door.
        if (!user.isActive) return null

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
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
