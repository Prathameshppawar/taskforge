# Deployment Guide

Target: **Vercel + Neon Postgres**. Any Node 20+ host works; only the cron
section is Vercel-specific.

---

## 1. Create the database (Neon)

### Easiest — the Vercel integration (sets the variables for you)

Vercel → **Storage** → find **Neon** → **Install** → pick region and plan →
**Connect Project** → tick Development, Preview and Production.

It provisions the database and writes `DATABASE_URL` (pooled) and
`DATABASE_URL_UNPOOLED` (direct) into the project. `prisma.config.ts` accepts
`DATABASE_URL_UNPOOLED` in place of `DIRECT_URL`, so there is nothing to rename.

### Or by hand

1. <https://console.neon.tech> → sign in → **Create a project**.
2. Click **Connect** in the console nav. The **“Connect to your database”**
   modal opens.
3. Choose **Branch**, **Compute**, **Database**, **Role**. The snippet dropdown
   should read **Connection string** (it defaults to that; switch it if it shows
   `psql`).
4. The **Connection pooling** toggle is **on by default**. Copy the string in
   both positions:

| Toggle | Hostname | Variable |
|---|---|---|
| **ON** | contains `-pooler` | `DATABASE_URL` — used by the app at runtime |
| **OFF** | no `-pooler` | `DIRECT_URL` — used by `prisma migrate` only |

Both must end with `?sslmode=require`.

> Why two: the pooled host runs PgBouncer, which keeps serverless functions
> under Neon's connection limit. Migrations take advisory locks that do not
> survive transaction pooling, so they need the direct host. Getting these the
> wrong way round makes `prisma migrate` sit and do nothing.

## 2. Generate secrets

```bash
openssl rand -base64 32   # -> AUTH_SECRET
openssl rand -hex 32      # -> CRON_SECRET
```

## 3. Push to GitHub and import into Vercel

```bash
git push origin main
```

In Vercel: **Add New → Project → import the repository**. Framework preset is
detected automatically. Do **not** deploy yet — add the environment variables first.

## 4. Environment variables

Add these under **Settings → Environment Variables** (Production *and* Preview).
Every variable is documented inline in [`.env.example`](../.env.example).

**Required**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string |
| `DIRECT_URL` | Neon **direct** connection string |
| `AUTH_SECRET` | From step 2 |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` | Used once, by the seed, to create the first admin |

**Recommended**

| Variable | Notes |
|---|---|
| `CRON_SECRET` | Required if you use recurring tickets |
| `BCRYPT_ROUNDS` | `12` for production |
| `NEXT_PUBLIC_APP_URL` | Your deployment URL |
| `AUTH_TRUST_HOST` | `true` if **not** on Vercel |

**Optional — AI Copilot**

| Variable | Notes |
|---|---|
| `AI_PROVIDER` | `groq`, `ollama`, or `none` |
| `GROQ_API_KEY` | From <https://console.groq.com/keys> |
| `GROQ_MODEL` | Default `openai/gpt-oss-120b` |

Leave `AI_PROVIDER=none` and the Copilot panel explains what to configure
instead of failing — the rest of the platform is unaffected.

> **Ollama on Vercel does not work** unless the host is publicly reachable.
> Serverless functions cannot see `127.0.0.1`. Use Groq for hosted deployments
> and keep Ollama for local development or a self-hosted server.

## 5. Deploy, then migrate and seed

Deploy from the Vercel dashboard. `npm run build` runs `prisma generate`
automatically, but **migrations are deliberately not run during the build** — a
build that silently mutates the schema is a bad idea when several deploys can
run concurrently.

The build does **not** need any environment variable: it is verified to succeed
with none set. A missing variable therefore cannot break the deploy, only a
request — and the error names the variable. This means you can deploy first and
add variables after, though adding them first saves a redeploy.

Run them once from your machine, pointed at production:

Inline variables take precedence over your local `.env`, so these commands
target production even though `.env` points somewhere else — verified, not
assumed.

```bash
# Use the PRODUCTION values here, not your local ones
DATABASE_URL="<neon pooled>" DIRECT_URL="<neon direct>" npx prisma migrate deploy

DATABASE_URL="<neon pooled>" DIRECT_URL="<neon direct>" \
  ADMIN_USERNAME=admin ADMIN_EMAIL=you@company.com \
  ADMIN_NAME="Platform Admin" ADMIN_PASSWORD='<a strong password>' \
  npm run db:seed
```

The seed is idempotent: it upserts roles and templates, and **never overwrites
an existing admin's password**. It is safe to re-run after adding a template.

Add `SEED_DEMO=true` to also create a demo workspace — useful for a staging
environment, never for production.

## 6. Recurring tickets (cron)

[`vercel.json`](../vercel.json) already registers the job:

```json
{ "crons": [{ "path": "/api/cron/recurring", "schedule": "0 6 * * *" }] }
```

Vercel sends `CRON_SECRET` as a Bearer token. Verify it manually:

```bash
curl -s "https://<your-app>.vercel.app/api/cron/recurring?key=$CRON_SECRET"
# -> {"ok":true,"generated":0,"tickets":[],"deactivated":0,"errors":[],"durationMs":8}
```

Without the key it returns `401`.

The sweep is safe to run more often than needed and safe to miss: each schedule
fires only once per due occurrence, and a schedule that missed several runs
generates **one** ticket and catches up, rather than flooding the board.

> Hobby-plan Vercel accounts are limited to one cron per day, which is enough
> for daily-or-longer schedules. Sub-daily recurrence needs a Pro plan or an
> external scheduler hitting the same URL.

## 7. Post-deploy checklist

- [ ] Sign in as the admin — you are forced to change the password if you left `ADMIN_PASSWORD` unset
- [ ] Change the seeded admin password
- [ ] Create your real users under **Admin → Users**
- [ ] Create a project from a template and confirm the board renders
- [ ] Verify the cron endpoint returns `401` without the key
- [ ] Confirm `.env` is **not** in the repository (`git log --all -- .env` should be empty)

---

## Operational notes

**Sessions.** JWT-based, which the Credentials provider requires. Sessions are
revoked server-side by bumping `User.sessionVersion`; deactivating a user or
resetting their password does this automatically. A live token is re-checked
against the database at most every 5 minutes, so revocation takes effect within
that window rather than at token expiry.

**Connection limits.** The pooled URL matters. In development, the Prisma client
is cached on `globalThis` so hot reloads don't exhaust the pool.

**Backups.** Neon keeps point-in-time history on paid plans. Verify your
retention window matches your recovery requirements — the platform itself stores
no file uploads, only links, so the database is the entire state.

**Scaling.** Every filter, sort and lookup the UI issues is index-backed (see
[`ER-DIAGRAM.md`](ER-DIAGRAM.md#4-index-coverage)). Dashboards aggregate with
`groupBy`/`count` rather than loading rows. Kanban ordering uses sparse float
positions, so a drag rewrites one row.

## Known advisory

`npm audit` reports a moderate advisory against the `postcss` version bundled
inside Next 15 (`GHSA-r28c-9q8g-f849`). It affects **source-map loading at build
time only** and is not reachable at runtime. It is fixed only in Next 16, which
would be a breaking change from the App Router version this project targets.
Revisit at the next major upgrade.

## Git identity and blocked deployments

Vercel refuses to build a commit whose author email it cannot match to a GitHub
account with access to the repository. The deployment is marked **Blocked** with
"the commit email … could not be matched to a GitHub account".

This bites when a machine has several GitHub identities — a work account and a
personal one — and the repository belongs to the personal one while git is
configured with the work email.

Set the identity per repository rather than globally:

```bash
# inside the repo
git config user.name  "<your-github-username>"
git config user.email "<id>+<username>@users.noreply.github.com"
```

GitHub's `users.noreply` address is always associated with the account and
keeps a real address out of the history. Find yours with:

```bash
gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'
```

A blocked deployment cannot be un-blocked by redeploying the same commit — the
commit itself carries the offending email. Push a new commit with the corrected
author, or rewrite the author of the existing one.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `prisma migrate deploy` hangs | `DIRECT_URL` is pointing at the pooled host |
| `Invalid environment configuration` on boot | A required variable is missing; the error names it |
| Signed out immediately after signing in | `AUTH_SECRET` differs between build and runtime, or is unset |
| `UntrustedHost` error | Set `AUTH_TRUST_HOST=true` (non-Vercel hosts) |
| Copilot says "not configured" | `AI_PROVIDER` is `none`, or the provider's key is missing |
| Cron returns 503 | `CRON_SECRET` is not set on the server |
| Too many connections | Using the direct URL as `DATABASE_URL` |
