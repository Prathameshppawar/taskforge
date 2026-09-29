# Deployment

How TaskForge is deployed: Vercel Hobby for the app, Neon's free Postgres for the
data, GitHub Actions for CI and the five-minute scheduler. Everything here stays
on free tiers. Day-to-day running (what the crons do, the job queue, limits,
backups, incidents) is in [OPERATIONS.md](OPERATIONS.md).

## Contents

1. [What runs where](#1-what-runs-where)
2. [First-time setup](#2-first-time-setup)
3. [Environment variables](#3-environment-variables)
4. [Migrations](#4-migrations)
5. [Scheduled work](#5-scheduled-work)
6. [CI](#6-ci)
7. [Shipping a change](#7-shipping-a-change)
8. [Post-deploy checks](#8-post-deploy-checks)
9. [Troubleshooting](#9-troubleshooting)
10. [Git identity and blocked deployments](#10-git-identity-and-blocked-deployments)
11. [Known advisory](#11-known-advisory)

---

## 1. What runs where

| Piece | Service | Plan | Notes |
|---|---|---|---|
| Next.js app, Server Actions, route handlers | Vercel | Hobby | Region `sin1` (Singapore), pinned in [`vercel.json`](../vercel.json) |
| Database | Neon Postgres | Free | Region `ap-southeast-1` (Singapore). Keep it in the same region as the functions: a cross-Pacific round trip made every page 7–10× slower before the region was pinned |
| Daily cron | Vercel Cron | Hobby | `/api/cron/recurring` at 06:00 UTC |
| Five-minute cron | GitHub Actions | Free | [`uptime.yml`](../.github/workflows/uptime.yml) calls `/api/cron/monitors` |
| CI | GitHub Actions | Free | [`ci.yml`](../.github/workflows/ci.yml) on every push and pull request to `main` |
| Outgoing and incoming email | Any SMTP/IMAP mailbox (a Gmail account with an app password works) | Free | Optional |
| AI | Groq free tier, or any engine configured in Workspace → AI | Free or pay as you go | Optional; the app runs with `AI_PROVIDER=none` |
| Embeddings | In-process (`@xenova/transformers`), weights cached in `/tmp` | — | No key, no per-call cost |

Pushing to `main` deploys to production straight away through Vercel's Git
integration. It does not wait for CI and it does not run migrations. That is why
[section 4](#4-migrations) has production migrated **before** the push.

---

## 2. First-time setup

### 2.1 Database (Neon)

Either install Neon from Vercel → **Storage** → **Neon** → **Connect Project**
(tick Development, Preview and Production), which writes `DATABASE_URL` (pooled)
and `DATABASE_URL_UNPOOLED` (direct) into the Vercel project; or create a project
at <https://console.neon.tech>, choose region **AWS Asia Pacific (Singapore)**, and
copy both connection strings from **Connect** (pooling on and off).

| String | Hostname | Variable | Used by |
|---|---|---|---|
| Pooled | contains `-pooler` | `DATABASE_URL` | The running app |
| Direct | no `-pooler` | `DIRECT_URL` or `DATABASE_URL_UNPOOLED` | `prisma migrate` only |

[`prisma.config.ts`](../prisma.config.ts) accepts `DATABASE_URL_UNPOOLED` in place of
`DIRECT_URL`, so the integration's names work unchanged. Migrations need the
direct host: they take advisory locks that PgBouncer's transaction pooling does not
keep, and through the pooler `migrate` hangs.

Step-by-step instructions for both routes are in
[ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md#1-database--database_url-and-direct_url).

### 2.2 Secrets

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # CRON_SECRET
```

Keep a copy of `AUTH_SECRET` somewhere safe. It signs sessions **and** is the key
every stored credential is sealed with; losing or changing it has consequences
described in [OPERATIONS.md](OPERATIONS.md#rotating-secrets).

### 2.3 Vercel project

1. Vercel → **Add New → Project** → import the GitHub repository. The Next.js
   preset is detected. `npm run build` runs `prisma generate && next build`.
2. Before the first deploy, add the environment variables from
   [section 3](#3-environment-variables) under **Settings → Environment
   Variables**, for Production (and Preview if you use previews against a separate
   Neon branch).
3. Link the local checkout once, so the CLI can pull variables later:

   ```bash
   npx vercel link
   ```

   `vercel` is a dev dependency, so `npx vercel` uses the pinned version.

The build needs no environment variables (CI proves this by building with none
set); a missing variable fails the request that needs it, with a message naming
it, never the deployment.

### 2.4 Migrate and seed production

From your machine, pointed at production. Inline variables win over your local
`.env` (dotenv never overrides a variable that is already set), so this does not
touch your local database:

```bash
DATABASE_URL="<neon pooled>" DIRECT_URL="<neon direct>" npx prisma migrate deploy

DATABASE_URL="<neon pooled>" DIRECT_URL="<neon direct>" \
  ADMIN_USERNAME=admin ADMIN_EMAIL=you@example.com \
  ADMIN_NAME="Platform Admin" ADMIN_PASSWORD='<a strong password>' \
  npm run db:seed
```

The seed upserts roles and templates and never overwrites an existing admin's
password, so it is safe to re-run. Without `ADMIN_PASSWORD` the admin is created
with `mustChangePassword` set. `SEED_DEMO=true` adds demo projects; use it for a
demo or staging database only.

### 2.5 Deploy

Deploy from the Vercel dashboard, or push to `main`. Then do the
[post-deploy checks](#8-post-deploy-checks).

### 2.6 The five-minute scheduler

In GitHub → the repository → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `TASKFORGE_URL` | The production base URL, no trailing slash, e.g. `https://taskforge-demo.vercel.app` |
| `CRON_SECRET` | The same value as the Vercel project's `CRON_SECRET` |

Then **Actions → Uptime checks → Run workflow** once to confirm. Without both
secrets the workflow exits successfully and does nothing.

---

## 3. Environment variables

[ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md) explains where to obtain the core
values; [`.env.example`](../.env.example) is annotated. The complete list the code
reads today:

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon pooled string, `?sslmode=require` |
| `DIRECT_URL` or `DATABASE_URL_UNPOOLED` | Neon direct string. Needed by migrations only, but set it on Vercel so `vercel env pull` can hand it to you |
| `AUTH_SECRET` | At least 16 characters; 32 random bytes recommended |

### Recommended

| Variable | Default | Notes |
|---|---|---|
| `CRON_SECRET` | none | Without it both cron routes answer 503 |
| `NEXT_PUBLIC_APP_URL` | none | Links in emails (notifications, welcome, budget alerts, usage report). Falls back to `AUTH_URL` for notification links |
| `BCRYPT_ROUNDS` | 12 | 8 to 15 |
| `SESSION_MAX_AGE` | 28800 | Seconds (8 hours) |
| `AUTH_URL` | inferred on Vercel | Required when self-hosting or behind a proxy. Never let a local `http://localhost:3000` value reach a deployment (see `.vercelignore`) |
| `AUTH_TRUST_HOST` | — | `true` on hosts other than Vercel |
| `NEXT_PUBLIC_APP_NAME` | `TaskForge` | Display name |

### First admin (seed only)

`ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`. Read by
`prisma/seed.ts` and nowhere else; they need not be set on Vercel.

### Email

| Variable | Notes |
|---|---|
| `EMAIL_HOST`, `EMAIL_PORT` (587), `EMAIL_USER`, `EMAIL_PASS` | SMTP. All of host, user and pass must be set for any email to send |
| `EMAIL_FROM` | Defaults to `<app name> <EMAIL_USER>` |
| `IMAP_HOST`, `IMAP_PORT` (993) | Email in. The host defaults to `EMAIL_HOST` with `smtp.` replaced by `imap.` |

### AI

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `none` | `groq`, `ollama` or `none`: the environment fallback for the Copilot. Engines configured in Workspace → AI take precedence |
| `GROQ_API_KEY`, `GROQ_MODEL` | `openai/gpt-oss-120b` | |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | `http://127.0.0.1:11434`, `llama3.1` | Not reachable from Vercel unless the host is public |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-opus-5` | "Fix with AI" and the agents |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | `gpt-5` | Same |
| `AI_MAX_TOKENS` | 2048 | Copilot response cap |
| `EMBEDDING_PROVIDER` | `local` | `none` falls back to lexical matching |
| `TRANSFORMERS_CACHE` | `/tmp/transformers` on Vercel | Where embedding weights are cached |

Keys can instead be stored, sealed, in Workspace → AI, with no redeploy.

### GitHub (optional overrides)

The normal route is **Workspace → Integrations → Create GitHub App**, which stores
the app in the database. Environment variables, when all three of the first set
are present, take precedence:

| Variable | Notes |
|---|---|
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | Pin the app by environment. The PEM may use literal `\n` |
| `GITHUB_APP_SLUG` | For install links |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The app's OAuth client, for personal GitHub authorisation |
| `GITHUB_WEBHOOK_URL` | Override the webhook URL in the manifest (a tunnel in development) |

### Single sign-on (optional)

| Variable | Provider |
|---|---|
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_LABEL` | Keycloak |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Microsoft Entra ID (issuer for a single tenant) |

A provider appears on the sign-in page only when its keys are set. No provider
creates accounts.

### Not environment variables

Vercel's rollback token and the Teams bot's credentials are entered in Workspace →
Integrations and stored sealed in `integration_secrets`. Outbound webhook secrets
are generated and sealed. `TASKFORGE_URL` and `TASKFORGE_TOKEN` are read by the
local MCP server ([MCP.md](MCP.md)) and the uptime workflow, not by the app.

Changing a variable on Vercel takes effect on the **next deployment**. Redeploy
after editing.

---

## 4. Migrations

### Why they are hand-written

Prisma does not know about the objects created in raw SQL
([ER-DIAGRAM.md, section 15](ER-DIAGRAM.md#15-objects-created-in-raw-sql)), so
`prisma migrate dev` proposes destroying them on almost every migration:

| Prisma proposes | Effect if accepted |
|---|---|
| `DROP INDEX "tickets_search_idx"` | Full-text search becomes a sequential scan |
| `DROP INDEX "tickets_key_trgm_idx"` | Partial key matching becomes a sequential scan |
| `ALTER TABLE "tickets" DROP COLUMN "embedding", ADD COLUMN "embedding" REAL[]` (and the same on `memory_chunks`) | Every stored vector is discarded |
| `ALTER TABLE "tickets" ALTER COLUMN "searchVector" DROP DEFAULT` | Fails or is a no-op on a generated column |

The migration header comments say so from `20260919092624_project_teams` onwards.
CI rejects any migration containing the first three (see [section 6](#6-ci)).
Anything that would drop the partial indexes (`tickets_embedding_pending_idx`,
`cycles_one_active_sprint`, `time_entries_one_running`), the triggers or their
functions must also be removed; the CI guard does not look for those.

### Writing a migration

1. Change `prisma/schema.prisma`.
2. Generate a draft against a **local** database that is up to date (not Neon;
   `migrate dev` needs a shadow database):

   ```bash
   npx prisma migrate dev --create-only --name project_default_view
   ```

3. Rename the folder so its timestamp sorts **after** the newest existing one.
   This repository's folder timestamps run ahead of the calendar (the latest is
   `20261004000000_project_default_view`), and Prisma applies folders in name
   order, so a folder named with today's date would sort before migrations that
   are already applied.
4. Edit `migration.sql`: keep only the additive half of the diff, delete the
   statements in the table above, and start the file with a comment saying what
   the migration does and what was removed. Every migration in the repository has
   such a header.
5. Apply locally and regenerate the client:

   ```bash
   npx prisma migrate deploy && npx prisma generate
   ```

6. Prefer additive changes. A column rename or drop needs two deploys: first ship
   code that no longer uses the column, then migrate it away. Production runs the
   old code for the minute between migrating and the new deployment going live.

### Applying to production, before pushing

Production must be migrated before the push that needs the migration, because
the push deploys immediately and new code against an old schema fails. Additive
migrations are safe to apply while the old code is still serving.

The production connection string is not in `.env` or `.env.local`. Pull it into a
temporary file outside the repository, use it, and delete it:

```bash
TMP=$(mktemp -d)
npx vercel env pull "$TMP/prod.env" --environment=production --yes

# 1. See what is pending. Expect only your own new migration(s).
(set -a && . "$TMP/prod.env" && set +a && \
  DIRECT_URL="$DATABASE_URL_UNPOOLED" npx prisma migrate status)

# 2. Apply.
(set -a && . "$TMP/prod.env" && set +a && \
  DIRECT_URL="$DATABASE_URL_UNPOOLED" npx prisma migrate deploy)

# 3. Confirm, then remove the file.
(set -a && . "$TMP/prod.env" && set +a && \
  DIRECT_URL="$DATABASE_URL_UNPOOLED" npx prisma migrate status)
rm -rf "$TMP"

git push origin main
```

Notes:

- The subshell `( … )` keeps production variables out of your shell session.
- `DATABASE_URL_UNPOOLED` is Neon's direct URL. If it is missing from the pulled
  file, `prisma.config.ts` falls back to the pooled `DATABASE_URL` with a warning,
  and `migrate` may hang.
- Variables marked **Sensitive** in Vercel are not readable by `vercel env pull`;
  they come through redacted (for example `[SENSITIVE]` or empty). If the database
  URLs are sensitive, copy the direct string from the Neon console instead and
  pass it inline as in [2.4](#24-migrate-and-seed-production). Do not copy any
  other value out of the pulled file.
- Never pull into the repository directory. `.gitignore` and `.vercelignore`
  exclude `.env*`, but a file with another name would be committed or uploaded.
- If `migrate status` lists a migration you did not write, stop: someone else's
  unpushed work, or a folder sorted out of order.

---

## 5. Scheduled work

| Schedule | Caller | Route | Auth |
|---|---|---|---|
| `0 6 * * *` (06:00 UTC daily) | Vercel Cron, from `vercel.json` | `/api/cron/recurring` | `Authorization: Bearer $CRON_SECRET`, sent by Vercel automatically; `?key=` also accepted |
| `*/5 * * * *` | GitHub Actions, `uptime.yml` | `/api/cron/monitors` | `Authorization: Bearer $CRON_SECRET` only |

What each does is in [OPERATIONS.md](OPERATIONS.md#scheduled-work).

Hobby-plan limits that shape this:

- Vercel Cron on Hobby runs at most once a day, and the invocation may land at any
  point within the scheduled hour. Anything more frequent comes from GitHub
  Actions.
- GitHub's scheduler is best effort. Five-minute schedules are often delayed at
  busy times, and scheduled workflows are disabled automatically in a public
  repository after 60 days without activity. Re-enable from the Actions tab.
  In practice this repository's five-minute job has run hours apart. For a
  dependable cadence, add a free external scheduler such as
  [cron-job.org](https://cron-job.org): call `GET <site>/api/cron/monitors` every
  five minutes with the header `Authorization: Bearer <CRON_SECRET>`. The route is
  safe to call more often than needed; the GitHub workflow can stay as a backup.
- GitHub Actions minutes are free and unlimited for public repositories. For a
  private repository the free allowance is 2,000 minutes a month, and every run
  bills at least one minute: 288 runs a day is about 8,600 minutes a month, far
  over. For a private repository, lengthen the schedule (`*/15` is about 2,900
  minutes, `*/30` about 1,450) or use a free external pinger that can send a
  header.

Both routes set `maxDuration` (120 s and 60 s). Check that the Vercel project's
function duration limit allows that; see Vercel's current Hobby limits.

---

## 6. CI

[`ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request to
`main`. It does not deploy and it does not touch production.

| Job | Steps | Catches |
|---|---|---|
| `verify` (Lint · Typecheck · Domain · Build) | `npm ci`, `prisma generate`, the raw-SQL guard, `npm run lint`, `npm run typecheck`, `npm run verify`, `npm run build` with **no** environment variables | Destructive migrations, type errors, broken domain rules, a build that depends on configuration |
| `e2e` (Browser suite) | A `postgres:16` service; `prisma migrate deploy` from empty; `npm run db:seed` with `SEED_DEMO=true`; `npm run verify:embeddings`; install Chrome; build; `npm run e2e`; upload the Playwright report on failure (kept 7 days) | Migrations that do not replay from zero, layout overflow, the forced password change, notifications, RBAC escalation, team-based project access |

The raw-SQL guard strips SQL comments, then fails if any `migration.sql` contains
`DROP INDEX "tickets_search_idx"`, `DROP INDEX "tickets_key_trgm_idx"` or
`DROP COLUMN "embedding"`. A header comment may explain the removal; only the
statement is forbidden.

Because Vercel deploys on push regardless of CI, run `npm run typecheck` and
`npm run verify` locally before pushing to `main`.

---

## 7. Shipping a change

1. `npm run typecheck && npm run verify` (and `npm run e2e` for layout work).
2. If the schema changed: write the migration ([4](#writing-a-migration)), apply
   it locally, then **apply it to production** ([4](#applying-to-production-before-pushing)).
3. Update the README entry for the feature and any affected docs.
4. Commit and `git push origin main`, from the GitHub identity Vercel expects
   ([section 10](#10-git-identity-and-blocked-deployments)).
5. Watch the deployment reach **Ready** in Vercel and the CI run go green.
6. [Post-deploy checks](#8-post-deploy-checks).

Rolling back: Vercel → **Deployments** → a previous production deployment →
**Promote** (Instant Rollback). This reverts code, not the database. Additive
migrations are compatible with the previous code, which is one more reason to
keep them additive.

---

## 8. Post-deploy checks

| Check | How | Expect |
|---|---|---|
| Deployment is live | Vercel → Deployments | **Ready**, on the commit you pushed |
| Schema matches | `migrate status` against production ([4](#applying-to-production-before-pushing)) | "Database schema is up to date!" |
| App serves | Sign in; open a project; open a ticket | The project lands on its default view (Insights unless changed); no error page |
| Cron routes are guarded | `curl -s -o /dev/null -w '%{http_code}\n' https://<app>/api/cron/monitors` | `401` (or `503` if `CRON_SECRET` is missing, which is a problem) |
| Five-minute cron works | GitHub → Actions → **Uptime checks** → Run workflow | Green; the log ends with a JSON body containing `"ok":true` |
| Daily cron is registered | Vercel → Settings → Cron Jobs | `/api/cron/recurring`, `0 6 * * *` |
| Queue is healthy | Workspace → Integrations → Webhooks card | "Background jobs: N waiting, 0 running, 0 failed" or close to it |
| No runtime errors | Vercel → Logs, filtered to errors, for a few minutes | Nothing new |

Avoid calling `/api/cron/recurring` by hand as a check: it is safe for recurring
tickets (each schedule fires once per occurrence), but it sends the daily digest
again, and on a Monday the weekly usage report and manager digest too. Use
Vercel's cron page to run it if you need to.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Deploy succeeded, but pages or actions fail with `The column … does not exist in the current database` or `Invalid prisma.….findMany() invocation … Unknown argument` | The code and generated client are newer than the production schema: the migration was not applied before the push | Apply it now ([4](#applying-to-production-before-pushing)). No redeploy is needed once the schema matches |
| `Unknown argument` locally after pulling | The local client is stale | `npx prisma generate`, restart `next dev` |
| `prisma migrate deploy` hangs | Migrating through the pooled host | Use the direct string (`DATABASE_URL_UNPOOLED` / no `-pooler`) as `DIRECT_URL` |
| `vercel env pull` gives empty or `[SENSITIVE]` database URLs | The variables are marked Sensitive | Copy the direct string from the Neon console and pass it inline |
| `vercel env pull` says the project is not linked | No `.vercel/` in the checkout | `npx vercel link` |
| `migrate status` shows a migration as pending that is already in production, or a drift warning | A folder was renamed after it was applied, or sorted before applied ones | Do not rename applied folders. Compare `_prisma_migrations` in production with the folder list |
| Migration fails with `P3018` partway | A statement failed (often a data backfill) | Fix the SQL, then `prisma migrate resolve --rolled-back <name>` and deploy again. Postgres DDL is transactional, so a failed migration normally leaves nothing half-applied |
| `Invalid environment configuration` on a request | A required variable is missing; the error names it | Add it on Vercel and redeploy |
| Signed out immediately after signing in, or every request redirects to `/login` | `AUTH_SECRET` missing or different between deployments, or a local `AUTH_URL=http://localhost:3000` reached the deployment and made the cookie non-secure | Set `AUTH_SECRET`; remove `AUTH_URL` from Vercel or set it to the real URL; never deploy with a local `.env` (see `.vercelignore`) |
| `UntrustedHost` | Not on Vercel | `AUTH_TRUST_HOST=true` |
| Cron route returns 503 | `CRON_SECRET` not set on the deployment | Set it and redeploy |
| Uptime workflow fails with 401 | The GitHub secret differs from Vercel's | Make them identical |
| Uptime workflow "succeeds" instantly with "nothing to do" | A repository secret is missing | Add `TASKFORGE_URL` and `CRON_SECRET` |
| Uptime workflow times out | A slow monitor, the mailbox or the job drain took longer than 90 s | See [OPERATIONS.md](OPERATIONS.md#common-incidents) |
| Too many connections | The direct string is used as `DATABASE_URL` | `DATABASE_URL` must be the pooled string |
| Copilot says it is not configured | No engine in Workspace → AI and `AI_PROVIDER=none` or no key | Configure an engine |
| First embedding call is slow or times out | Weights (about 33 MB) download on a cold start | Expected once per instance; the daily sweep has 120 s |
| GitHub App cannot be created from production | The webhook URL is not public | Production is public; for local testing set `GITHUB_WEBHOOK_URL` to a tunnel |

---

## 10. Git identity and blocked deployments

Vercel refuses to build a commit whose author email it cannot match to a GitHub
account with access to the repository. The deployment is marked **Blocked**: "the
commit email … could not be matched to a GitHub account". This happens on a
machine with several GitHub identities when the commit carries the wrong one.

Set the identity per repository:

```bash
git config user.name  "<github-username>"
git config user.email "<id>+<username>@users.noreply.github.com"
gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'   # finds yours
```

Redeploying a blocked commit does not help; the commit carries the email. Push a
new commit with the right author.

## 11. Known advisory

`npm audit` reports a moderate advisory against the `postcss` bundled inside
Next 15 (`GHSA-r28c-9q8g-f849`). It affects source-map loading at build time only
and is not reachable at runtime. It is fixed in Next 16, a breaking upgrade;
revisit then.
