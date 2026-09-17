import { PrismaClient } from '@prisma/client'

/**
 * Single Prisma instance.
 *
 * In development Next.js hot-reloads modules on every edit; without the global
 * cache each reload would open a new pool and exhaust Neon's connection limit.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export type { Prisma } from '@prisma/client'
