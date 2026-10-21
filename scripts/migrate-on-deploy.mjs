/**
 * Applies pending migrations as part of a production build on Vercel.
 *
 * `vercel-build` runs this before `next build`, so a deployment's code and the
 * production schema arrive together: if the migration fails or hangs, the
 * build fails and the previous deployment keeps serving, rather than new code
 * going live against an old schema. Migrations here are additive (see
 * docs/DEPLOYMENT.md, section 4), so applying one while the old code still
 * serves is safe.
 *
 * Only production builds migrate. A preview build may share the production
 * database, and must not change it ahead of a merge. Locally and in CI this
 * does nothing; `npm run build` does not call it at all.
 *
 * `prisma.config.ts` picks the direct connection (`DIRECT_URL` or Neon's
 * `DATABASE_URL_UNPOOLED`). The time limit turns the one known way this goes
 * wrong — migrating through the pooled host, which can hang on advisory
 * locks — into a failed build instead of one that runs until Vercel kills it.
 */
import { spawnSync } from 'node:child_process'

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`[migrate-on-deploy] skipped: not a production build (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'})`)
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('[migrate-on-deploy] DATABASE_URL is not set for production builds; refusing to deploy without migrating.')
  process.exit(1)
}

console.log('[migrate-on-deploy] applying pending migrations to production')
const run = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  timeout: 180_000,
})

if (run.error || run.status !== 0) {
  console.error(`[migrate-on-deploy] prisma migrate deploy failed${run.error ? `: ${run.error.message}` : ` with exit code ${run.status}`}`)
  process.exit(1)
}
