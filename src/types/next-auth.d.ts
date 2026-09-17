import type { RoleKey } from '@prisma/client'

/**
 * Auth.js type augmentation.
 *
 * NOTE ON MODULE PATHS: `next-auth` and `next-auth/jwt` only *re-export* these
 * interfaces — the declarations themselves live in `@auth/core`. Augmenting the
 * re-export does not merge with the source interface, so the augmentation must
 * target `@auth/core/types` and `@auth/core/jwt` directly.
 *
 * `DefaultSession.user` is typed as `User`, so extending `User` here is what
 * makes `session.user.role` (and friends) available everywhere.
 */
declare module '@auth/core/types' {
  interface User {
    username: string
    role: RoleKey
    isActive: boolean
    mustChangePassword: boolean
    avatarColor: string
    sessionVersion: number
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string
    username: string
    role: RoleKey
    isActive: boolean
    mustChangePassword: boolean
    avatarColor: string
    sessionVersion: number
    /** Epoch ms of the last database revalidation of this token. */
    checkedAt: number
  }
}

export {}
