import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI configuration.
 *
 * Exists for one reason: Neon's Vercel integration provisions the direct
 * connection string as `DATABASE_URL_UNPOOLED`, while Prisma's convention — and
 * this schema — is `DIRECT_URL`. Rather than making people rename a variable by
 * hand, accept either.
 *
 * `directUrl` is read by the Prisma CLI only (migrate / db push / introspect);
 * the running app never uses it, so this affects local and CI migrations, not
 * the deployed runtime.
 */
if (!process.env.DIRECT_URL && process.env.DATABASE_URL_UNPOOLED) {
  process.env.DIRECT_URL = process.env.DATABASE_URL_UNPOOLED
}

// Last resort: migrating through the pooled host can hang on advisory locks,
// but failing outright with "environment variable not found" is worse than
// trying. Warn loudly and continue.
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  if (process.env.DATABASE_URL.includes('-pooler')) {
    console.warn(
      '\n⚠️  DIRECT_URL is not set, so migrations will run through the POOLED host.\n' +
        '   If `prisma migrate` appears to hang, set DIRECT_URL to the Neon\n' +
        '   connection string with "Connection pooling" switched OFF.\n',
    )
  }
  process.env.DIRECT_URL = process.env.DATABASE_URL
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
