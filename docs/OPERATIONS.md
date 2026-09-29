# Operations

Running TaskForge day to day on free tiers: what the scheduled work does, how the
job queue behaves, what fills the database, how to back it up and restore it, how
to rotate secrets, where to look when something is wrong, and how to switch on
each opt-in automation. Setting it up in the first place is in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Contents

1. [Scheduled work](#scheduled-work)
   - [The daily cron: `/api/cron/recurring`](#the-daily-cron-apicronrecurring)
   - [The five-minute cron: `/api/cron/monitors`](#the-five-minute-cron-apicronmonitors)
2. [The job queue](#the-job-queue)
3. [Free-tier limits and what consumes them](#free-tier-limits-and-what-consumes-them)
4. [What grows in the database](#what-grows-in-the-database)
5. [Backups and restore](#backups-and-restore)
6. [Rotating secrets](#rotating-secrets)
7. [Monitoring and logs](#monitoring-and-logs)
8. [Common incidents](#common-incidents)
9. [Enabling each opt-in automation](#enabling-each-opt-in-automation)

---

## Scheduled work

Two routes do all scheduled work. Both require `CRON_SECRET` (503 if it is not
configured, 401 if it does not match), compare it in constant time, and return a
JSON summary of what they did. Each step catches its own failure and logs it, so
one broken integration does not stop the others.

### The daily cron: `/api/cron/recurring`

Called by Vercel Cron at 06:00 UTC ([`vercel.json`](../vercel.json)); on Hobby the
call can land anywhere in that hour. `maxDuration` is 120 s.
Source: [`app/api/cron/recurring/route.ts`](../src/app/api/cron/recurring/route.ts).

| Step | Runs | What it does | In the response |
|---|---|---|---|
| Recurring tickets | Daily | `generateDueTickets`: every active schedule whose `nextRunAt` has passed creates one ticket and advances `nextRunAt` past now. A schedule that missed several runs creates one ticket, not a flood. Schedules past their `endDate` are deactivated. If this step throws, the whole route returns 500 | `generated`, `tickets`, `deactivated`, `errors` |
| Embedding sweep | Daily | `sweepEmbeddings(300)`: embeds up to 300 tickets whose embedding is missing or whose text changed (by `embeddingHash`). Loads the model on a cold start | `embedded`, `embeddingsRemaining` (-1 if the sweep failed) |
| GitHub reconcile | Daily, if GitHub is connected | `reconcileAllLinked`: asks GitHub for the current state of linked repositories' branches, pull requests and checks, catching anything a webhook missed | `github` (null when not connected) |
| Model prices | Mondays | `refreshModelPrices`: refreshes list prices marked `auto` from the public catalogue; prices a person typed are kept | `prices` |
| Weekly AI usage report | Mondays | `sendWeeklyUsageReport`: last week's spend by project, person and provider, emailed to subscribers | `usageReport` |
| Manager digest | Mondays, if email is configured | `sendManagerDigests`: a weekly digest to each project's managers who have `emailDigest` on | `managerDigest` |
| Daily digest | Daily, for projects with `dailyDigest` on | `sendDailyDigests`: stuck, at risk, due, waiting on the client, emailed to managers and posted to linked Teams channels. A quiet day sends nothing. **Not deduplicated**: calling the route twice sends it twice | `dailyDigest` |
| Memory indexing | Daily, for projects with `memoryEnabled` | Queues a `memory.index` job per project (dedupe key `memory:<projectId>`) | via `jobs` |
| Handbook refresh | Mondays, for projects with `handbookAutoRefresh` | Queues a `handbook.generate` job per project | via `jobs` |
| Job drain | Daily | `drain({ limit: 10, budgetMs: 60000 })` | `jobs: { ran, failed }` |

06:00 UTC is 11:30 in India and 14:00 in Singapore; the "morning" digest is
morning only for Europe. Changing the hour is a one-line edit to `vercel.json`.

### The five-minute cron: `/api/cron/monitors`

Called by GitHub Actions ([`uptime.yml`](../.github/workflows/uptime.yml)) every
five minutes, best effort. `maxDuration` is 60 s; the workflow's `curl` waits 90 s.
Source: [`app/api/cron/monitors/route.ts`](../src/app/api/cron/monitors/route.ts).

| Step | What it does | In the response |
|---|---|---|
| Uptime monitors | `runDueMonitors`: checks every active monitor whose `intervalMinutes` has elapsed (with 30 s slack). A check re-resolves DNS and refuses private addresses, does not follow redirects, times out after 10 s, and optionally requires a keyword. After `failureThreshold` failures in a row it opens one Production incident ticket (as TaskForge Ops); on recovery it comments with the outage length. Deletes `monitor_checks` older than seven days. Not wrapped in a catch: if it throws, the route returns 500 | `checked`, `down` |
| SLA alerts | `sweepSlaAlerts`: for open tickets whose priority has targets and whose kind is in the project's `slaKinds`, sends `SLA_AT_RISK` at 80% and `SLA_BREACHED` on breach, once each (`ticket_sla_alerts`). Up to 2,000 tickets per run | `sla` |
| Email in | `pollMailbox(15)`: if email in is on and SMTP/IMAP are configured, reads up to 15 unseen messages to plus addresses, files tickets or comments, and records each in `inbound_emails` | `email` |
| Webhook outbox | `sweepOutbox`: reads new `ticket_status_changes` and `comments` since the cursor and queues one `webhook.deliver` job per event per subscribed webhook. With no active webhooks it just moves the cursor, so a first webhook does not replay history | `outbox: { queued }` |
| Job drain | `drain({ limit: 20, budgetMs: 30000 })` | `jobs: { ran, failed }` |

Calling this route more often than every five minutes is harmless: monitors only
run when due, alerts are sent once, the mailbox and outbox are idempotent.

---

## The job queue

Background work runs on a queue kept in Postgres
([`features/jobs/queue.ts`](../src/features/jobs/queue.ts),
[`core/domain/jobs.ts`](../src/core/domain/jobs.ts)), instead of a paid job
service.

### Kinds

| Kind | Queued by | Handler | Attempts |
|---|---|---|---|
| `webhook.deliver` | The outbox sweep | `features/webhooks-out/service.ts` `deliverJob` | 6 |
| `triage.ticket` | A new ticket in a project with `triageAgent` on | `features/triage-agent/service.ts` `triageJob` | 5 |
| `memory.index` | The daily cron; turning memory on; saving or generating a handbook (a manual re-index from project settings runs directly, not through the queue) | `features/memory/index-service.ts` `indexJob` | 5 |
| `handbook.generate` | The Monday cron, for projects with `handbookAutoRefresh` (Generate on the handbook page runs directly) | `features/memory/handbook.ts` `handbookJob` | 5 |

### States

```
PENDING ──claim──▶ RUNNING ──ok──▶ DONE ──(7 days)──▶ deleted
   ▲                  │
   │                  ├─error, attempts < max──▶ PENDING (runAt = backoff)
   │                  ├─error, attempts = max──▶ FAILED ──Retry failed──▶ PENDING
   └──(locked > 10 min, next drain)──┘
```

| Behaviour | Detail |
|---|---|
| When work starts | `enqueue` inside a request schedules a small drain (5 jobs, 20 s) with Next.js `after()`, once the response is sent. Outside a request, or with `drainSoon: false`, the next cron drain picks it up |
| Claiming | `UPDATE … WHERE id IN (SELECT … WHERE status = 'PENDING' AND runAt <= now() ORDER BY runAt LIMIT n FOR UPDATE SKIP LOCKED)`, so two drains never take the same job. Claiming increments `attempts` |
| Deduplication | `dedupeKey` is unique. Queuing a key that is already pending or running is a no-op. The key is cleared when the job finishes or fails, so the same work can be queued again later |
| Retries | After a failure the job goes back to PENDING with `runAt` delayed 1 min, 5 min, 30 min, 2 h, then 6 h. With 5 attempts the last delay used is 2 h (about 2.5 hours in total); webhook deliveries, with 6, retry for about 8.5 hours |
| Time budget | A drain stops starting jobs when its budget is spent and hands unstarted ones back with the attempt refunded |
| Stale locks | A job RUNNING for more than 10 minutes belonged to a function that died; the next drain puts it back to PENDING. The attempt it used is not refunded |
| Pruning | Every drain deletes DONE jobs older than 7 days. FAILED jobs are kept until retried or deleted |

### Seeing and retrying failures

**Workspace → Integrations**, at the foot of the Webhooks card (needs
`integration:manage`): "Background jobs: N waiting, N running, N failed", the last
five failures with their kind and error, and **Retry failed**, which resets every
failed job to PENDING with zero attempts and drains.

For more detail, from a SQL console on Neon:

```sql
SELECT "status", "kind", count(*) FROM "jobs" GROUP BY 1, 2 ORDER BY 1, 2;

SELECT "id", "kind", "attempts", "runAt", "lastError", "payload"
FROM "jobs" WHERE "status" = 'FAILED' ORDER BY "updatedAt" DESC LIMIT 20;

-- Retry one
UPDATE "jobs" SET "status" = 'PENDING', "attempts" = 0, "runAt" = now(), "lastError" = NULL WHERE "id" = '<id>';

-- Give up on old failures
DELETE FROM "jobs" WHERE "status" = 'FAILED' AND "updatedAt" < now() - interval '30 days';
```

Deleting a webhook also deletes its pending and failed deliveries.

---

## Free-tier limits and what consumes them

Limits as published at the time of writing; the providers change them, so check
their pricing pages before relying on a figure.

| Service | Limit | What in TaskForge consumes it | What to do near the ceiling |
|---|---|---|---|
| Neon storage | 0.5 GB per project | The database is the entire state: tickets, history, audit, attachments and photos (bytea), embeddings. See [the next section](#what-grows-in-the-database) | Measure, prune, cap attachments |
| Neon compute | A monthly allowance of compute hours; computes suspend after 5 minutes idle | Every request, and every cron call. The five-minute cron wakes the database up to 288 times a day, so it may rarely get to suspend | Watch Neon → Usage. If compute is heading past the allowance, lengthen the uptime schedule to `*/10` or `*/15` in `uptime.yml`; monitors with a longer `intervalMinutes` lose nothing |
| Neon restore window | Short on Free (hours, not days) | — | Keep your own dumps; see [Backups](#backups-and-restore) |
| Vercel Hobby functions | A monthly invocation and CPU allowance | Every page, action and API call; `/api/live` polling (one request per open tab every 20 s, only for projects with live updates on); both crons | Keep live updates for the projects that need them |
| Vercel Hobby cron | Once a day, timing within the hour | `/api/cron/recurring` | Anything sub-daily goes in the five-minute route |
| Vercel Hobby logs | Runtime logs are kept only briefly | — | Use the cron JSON in GitHub Actions logs as the durable record; see [Monitoring](#monitoring-and-logs) |
| GitHub Actions | Unlimited minutes for public repositories; 2,000 a month for private | `uptime.yml` (288 runs a day, each billed as at least a minute), `ci.yml` | For a private repository, run the uptime workflow every 15 or 30 minutes |
| GitHub scheduled workflows | Disabled after 60 days without repository activity (public repositories) | `uptime.yml` | Re-enable from the Actions tab; any push resets the clock |
| Groq free tier | About 8,000 tokens a minute and 200,000 a day for the default model ([README](../README.md#what-a-conversation-costs)) | The Copilot, capture, filters, weekly update, handbook, triage, Teams bot turns, email structuring, and the agents if assigned to Groq | Slash commands need no model; assign heavy agents to another engine; set budgets in Workspace → AI |
| Gmail SMTP | A daily sending cap (about 500 recipients for a personal account) | Notification emails, welcome emails, digests, budget alerts, email-in replies | People can turn email notifications off in Settings → Notifications |

---

## What grows in the database

Measure first. In the Neon SQL editor:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS total;

SELECT relname AS table,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_relation_size(relid)) AS data,
       n_live_tup AS rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

| Table | Grows with | Bounded by | Notes |
|---|---|---|---|
| `ticket_attachment_data` | Every attachment | 5 MB each, 20 per ticket; nothing global | The fastest way to fill 0.5 GB: a hundred large screenshots is most of it. Link large files under Resources instead |
| `user_avatar_images` | One per person with a photo | 256 KB each | Small |
| `tickets` | Tickets | — | Each row carries a `tsvector` and a 384-float embedding (about 1.5 KB), plus the GIN indexes |
| `memory_chunks` | Finished tickets, repository docs, handbook | **3,000 per project**; at most 25 doc files per repository | Text plus a 1.5 KB embedding each: roughly 10 MB per project at the cap. Turning memory off deletes the project's chunks |
| `activity_logs` | Every change | Never pruned | The audit trail; do not prune casually |
| `ticket_status_changes`, `ticket_cycle_changes` | Every status or cycle move (trigger-written) | Never pruned | Forecasts, DORA, time in status and webhooks read them |
| `notifications` | Mentions, assignments, replies, blocks, SLA alerts | Never pruned | Read notifications can be pruned safely |
| `ai_usage_events` | Every model call | Never pruned | Small rows; budgets and reports read the current and previous months |
| `ai_fix_runs` | Every "Fix with AI" run | Never pruned | `transcript` can be tens of KB per run |
| `inbound_emails` | Every message the mailbox read | Never pruned | Metadata only (no bodies). Old rows are safe to delete: the poller only reads recent unseen mail |
| `jobs` | Queued work | DONE pruned after 7 days; FAILED kept | See [the job queue](#the-job-queue) |
| `monitor_checks` | One row per check | Pruned after 7 days | About 2,000 rows a week per five-minute monitor |
| `msteams_messages` | Bot conversations | Trimmed to the recent turns after every reply | Small |
| `project_documents` | Handbook versions | Every version kept | One row per generation or edit |

Optional manual pruning, after taking a backup:

```sql
DELETE FROM "notifications" WHERE "readAt" IS NOT NULL AND "createdAt" < now() - interval '180 days';
DELETE FROM "inbound_emails" WHERE "createdAt" < now() - interval '90 days';
DELETE FROM "jobs" WHERE "status" = 'FAILED' AND "updatedAt" < now() - interval '30 days';
UPDATE "ai_fix_runs" SET "transcript" = NULL WHERE "finishedAt" < now() - interval '90 days';
```

Deleted rows free space for reuse once autovacuum runs; the reported size does not
shrink straight away. `VACUUM FULL <table>` returns space immediately but locks the
table while it rewrites it; run it in a quiet moment, and only on a table that
matters.

---

## Backups and restore

The database is the whole of TaskForge's state: there is no file storage
elsewhere. Sealed credentials in it can only be opened with the same
`AUTH_SECRET`, so keep that secret with the backups (separately and securely).

### Neon's own history

Neon keeps a restore window of recent history (short on the Free plan). Within it:

- **Inspect a past state without touching production**: Console → Branches →
  create a branch from a point in time, and query it. Nothing in production
  changes.
- **Restore production to a point in time**: Console → the branch → Restore (or
  reset from a past point). Everything after that moment is lost, including
  tickets people created since. Neon keeps a backup of the pre-restore state for a
  while, so the restore itself can be undone.

The restore window does not help with anything older than the window, so keep
dumps too.

### Your own dumps

Take one before any risky migration, before rotating `AUTH_SECRET`, and on a
regular schedule. Use the **direct** connection string and a `pg_dump` at least as
new as the server (`SHOW server_version;`):

```bash
pg_dump "$DIRECT_URL" --format=custom --no-owner --no-privileges \
  --file="taskforge-$(date +%Y%m%d).dump"
```

Keep dumps off the repository and out of GitHub Actions artifacts (artifacts of a
public repository are downloadable by anyone). A dump contains everything,
including password hashes and attachments.

### Restoring a dump

Restore into a fresh Neon branch or project, not over production:

```bash
pg_restore --no-owner --no-privileges --dbname="$TARGET_DIRECT_URL" taskforge-YYYYMMDD.dump
```

The dump carries the `pg_trgm` extension, the generated `searchVector` column,
the partial indexes, the trigger functions and triggers, and `_prisma_migrations`,
so afterwards `prisma migrate status` against the target should report the schema
up to date. Do not rebuild a database with `prisma db push`: it would create
none of the raw-SQL objects.

To switch production to the restored database, update `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` on Vercel and redeploy.

---

## Rotating secrets

| Secret | Where it lives | Effect of rotating | Procedure |
|---|---|---|---|
| `CRON_SECRET` | Vercel env; GitHub secret `CRON_SECRET` | Crons that run with the old value get 401 until both sides match | Generate (`openssl rand -hex 32`), set on Vercel, redeploy, set the GitHub secret. Vercel Cron picks up the new value itself. A few missed five-minute runs only delay monitors, SLA alerts and email in |
| `AUTH_SECRET` | Vercel env | **Everyone is signed out** (sessions are JWTs signed with it). **Every sealed credential becomes unreadable**: the GitHub App's private key, webhook secret and client secret (unless pinned by `GITHUB_APP_*` env), engine API keys stored in Workspace → AI, the Vercel token, the Teams bot secret, personal GitHub authorisations, and outbound webhook signing secrets. Not affected: passwords (bcrypt), access tokens and error-ingest URLs (SHA-256), keys set as environment variables | Rotate only if it has leaked. Take a dump first. Set the new value, redeploy, then reconnect: GitHub App (Workspace → Integrations, or pin it with `GITHUB_APP_*`), re-enter engine keys, the Vercel token and the Teams secret, recreate each outbound webhook (its receiver needs the new signing secret; old ones fail and their deliveries end up FAILED), and ask people to reconnect GitHub in Settings → GitHub |
| Database password | Neon role; Vercel `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | The app cannot connect between the reset and the redeploy | Reset in Neon, update both variables on Vercel (the Neon integration may do this for you; check), redeploy |
| `EMAIL_PASS` (app password) | Vercel env | Email out and in stop until updated | Create a new app password, revoke the old, update, redeploy |
| Engine keys in env (`GROQ_API_KEY`…) | Vercel env | That engine fails until updated | Update, redeploy; or store the key in Workspace → AI, which needs no redeploy |
| GitHub App secrets pinned by env | Vercel env and the GitHub App's settings | Webhooks fail signature checks until both match | Change in GitHub first, then the env var, then redeploy; the daily reconcile catches up anything missed |
| Personal access tokens | Settings → Access tokens | Clients using the token get 401 | Revoke and create a new one |
| Error-ingest URL | Project settings | The old URL returns 404 | Regenerate, update Sentry or the app's handler |

---

## Monitoring and logs

| Where | What it tells you |
|---|---|
| GitHub → Actions → **Uptime checks** | Every five-minute run and the JSON body it received: monitors checked and down, SLA alerts sent, email read and outcomes, webhook events queued, jobs ran and failed, duration. The most durable log there is; a red run means the route failed or timed out |
| Vercel → Settings → **Cron Jobs** | The daily cron's registration and recent invocations; logs link through to the function |
| Vercel → **Logs** | Runtime logs. Filter on `[cron]`, `[cron/recurring]` and `[jobs]`, which prefix every swallowed failure. Retention on Hobby is short |
| Vercel → **Deployments** | Build output, and the deployment currently serving |
| Workspace → **Integrations** | GitHub installation and repository state; Vercel connection; email in (on/off, last poll, last error, the log of messages and outcomes, **Check now**); Teams bot status; each webhook's last status and error; job queue counts and recent failures |
| Workspace → **AI** | Spend by person, project, engine and feature; budgets and their alert state; each engine's key hint |
| Workspace → **Sessions** | Who is signed in, and revocation |
| Project settings | Monitors (state, latency, last error), error-ingest setup, email address, memory and handbook status |
| Project **Insights** | Flow, stuck work, DORA |
| Neon console → Monitoring, Usage | Storage, compute hours, connections |
| GitHub → the App's **Advanced** tab | Webhook deliveries GitHub attempted, with responses and redelivery |

There is no alerting beyond what TaskForge does itself (incident tickets from
monitors, budget emails, SLA notifications). To be told when TaskForge itself is
down, add a monitor in a project that points at TaskForge's own `/login`; the
GitHub also emails the person who last changed a workflow's schedule when a scheduled run fails.

---

## Common incidents

| Incident | Likely cause | Fix |
|---|---|---|
| After a deploy, pages fail with `column … does not exist` or `Unknown argument` | The migration was not applied to production before the push | Apply it ([DEPLOYMENT.md](DEPLOYMENT.md#applying-to-production-before-pushing)); no redeploy needed |
| Everyone was signed out, and Integrations says credentials cannot be read | `AUTH_SECRET` changed | Restore the old value if you have it; otherwise reconnect as in [Rotating secrets](#rotating-secrets) |
| Uptime runs are red with 401 | `CRON_SECRET` differs between Vercel and GitHub | Make them match |
| Uptime runs are red with 503 | `CRON_SECRET` missing on Vercel | Set it, redeploy |
| Uptime runs are red with a timeout or 504 | A step took too long: many due monitors, a slow mailbox, or a slow job in the drain | Check the Vercel log for the `[cron]` line; reduce monitors' frequency; failed jobs retry on their own |
| No uptime runs at all | The scheduled workflow was disabled (60 days without activity) or GitHub is delaying schedules | Re-enable it in the Actions tab. GitHub can delay schedules by hours; for a dependable five-minute cadence, point a free external scheduler (cron-job.org) at `GET /api/cron/monitors` with `Authorization: Bearer <CRON_SECRET>` — see [DEPLOYMENT.md](DEPLOYMENT.md#5-scheduled-work) |
| Recurring tickets did not appear | The daily cron did not run or failed (it returns 500 if generation throws) | Vercel → Cron Jobs; run it from there once fixed. It catches up with one ticket per schedule |
| Jobs pile up as waiting | Nothing is draining: the five-minute cron is not running | Fix the uptime workflow; a request that queues a job also drains a few |
| Jobs are FAILED | A handler error; the message is on Integrations | Fix the cause (a webhook receiver down, an engine key missing, a repository no longer accessible), then **Retry failed** |
| Jobs stuck RUNNING | A function died mid-job | Nothing to do: the next drain reclaims them after 10 minutes |
| Emails are not becoming tickets | Email in off; the project's `emailIntake` off; IMAP not configured; the sender failed authentication or has no active account | Integrations → Email in shows the last error and each message's outcome and reason |
| Email stopped sending | SMTP credentials wrong or revoked, or the provider's daily cap | Vercel logs from the mailer; replace the app password |
| A pull request did not move its ticket | The webhook delivery was missed or failed | The daily reconcile fixes it; to fix now, redeliver from the GitHub App's Advanced tab or press Refresh on Integrations |
| "Fix with AI" is refused writing a workflow | The project has `aiWorkflows` off, or the GitHub App lacks the Workflows permission | Turn it on per project; grant the permission in the App's settings and accept it on the installation |
| A monitor says "resolves to a private address" | The URL points at a private or local network | Monitors only check public addresses, on purpose |
| Copilot or agents fail with rate-limit errors | Groq's per-minute or per-day tokens | Wait, use slash commands, or assign agents to another engine |
| Neon storage close to 0.5 GB | Usually attachments | Measure with the size query; prune; see [What grows](#what-grows-in-the-database) |
| Neon compute allowance running out | The database rarely suspends | Lengthen the uptime schedule; if the allowance is exhausted the database is suspended until the month resets |
| Search results are missing a new ticket's similar tickets | Its embedding is not computed yet | The daily sweep embeds up to 300; `npm run embed:backfill` against production does the rest |
| The board does not refresh for others | Live updates are off for the project | Project settings → Live updates |

---

## Enabling each opt-in automation

Everything below is off, or inert, until configured. "Five-minute cron" means the
uptime workflow with both GitHub secrets set.

| Automation | Needs | Switch it on | Check it works |
|---|---|---|---|
| Recurring tickets | `CRON_SECRET` on Vercel; the `vercel.json` cron | Project → Recurring → add a schedule | Next day, the cron response lists the ticket |
| Uptime monitors | Five-minute cron | Project settings → Monitors → add a URL | Checks appear with latency; a failing URL opens an incident after the threshold |
| SLA alerts | Five-minute cron; targets on priorities | Project settings: set respond and resolve hours on priorities; choose `slaKinds` | `sla.sent` in the uptime run output; notifications at 80% and on breach |
| Email notifications | `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS` (and `EMAIL_PORT`, `EMAIL_FROM`); `NEXT_PUBLIC_APP_URL` for links | On by default per person (Settings → Notifications) | Assign a ticket to someone else |
| Email in | Email configured; IMAP reachable (`IMAP_HOST`/`IMAP_PORT` if not derivable); five-minute cron | Workspace → Integrations → Email in on; each project → settings → email intake on | Send to `mailbox+code@…`; Integrations lists the message as CREATED |
| GitHub | A public URL for webhooks | Workspace → Integrations → Create GitHub App → install on an account; project settings → link repositories | A branch named with a ticket key appears on the ticket |
| GitHub status automation | GitHub connected | On by default per project (`githubAutomation`) | Open a pull request mentioning a key: the ticket moves to Review |
| Fix with AI | GitHub connected; an engine with a key (Workspace → AI or env); the `ai:code` permission | The button appears on tickets in projects with linked repositories | A run opens a pull request |
| AI writing workflows, auto-heal, draft until green, auto-merge | Fix with AI; for workflows, the App's Workflows permission | Project settings → the AI switches; auto-merge bounds (`autoMergeMaxLines`, `autoMergeKinds`) | The run log and the pull request state |
| AI review, release notes, post-mortems | An engine | Buttons on pull requests, Deployment tickets, Production tickets | Output on the ticket |
| Deployment tracking | GitHub connected; the host reports deployments to GitHub (Vercel does) | Automatic for linked repositories | Preview links and "Live in Production" on tickets |
| Vercel rollback | A Vercel token (and team id if the project is in a team) | Workspace → Integrations → Vercel | The rollback button on Production tickets |
| Production error ingest | — | Project settings → generate the ingest URL; point Sentry's webhook or an error handler at it | An error creates a Production ticket |
| Microsoft Teams bot | A bot in the Teams Developer Portal pointed at `/api/msteams/messages`, with a client secret | Workspace → Integrations → Teams: bot id, secret, tenant; download the app package and upload it to Teams | Message the bot; in a channel, `link CODE` |
| Outbound webhooks | Five-minute cron | Workspace → Integrations → Webhooks → add; store the secret shown once | "Send test", then `lastStatus` on the card |
| Triage agent | An engine (for choosing between candidates) | Project settings → Triage agent | A new ticket gets a triage comment with Undo |
| Daily digest | Email configured and/or a linked Teams channel; the daily cron | Project settings → Daily digest | A morning email to managers on a day with something to report |
| Manager digest (weekly) | Email configured | On by default for managers (`emailDigest`), Mondays | Monday's cron output `managerDigest` |
| Project memory | Nothing (in-process embeddings) | On by default; project settings to refresh or turn off | Copilot `search_memory` finds past work |
| Handbook | An engine for the written version (without one, the facts are the handbook) | Project → Handbook → Generate; project settings → refresh every Monday | A new version on the Handbook page |
| AI budgets and usage report | Email configured for alerts and reports | Workspace → AI → budgets and subscriptions | Alerts at 80% and 100%; the Monday report |
| Live updates | — | Project settings → Live updates | Another person's change appears within 20 s |
| Single sign-on | The provider's env vars; accounts already existing with the same verified email | Set the variables and redeploy | The provider's button on `/login` |
| Semantic similarity | `EMBEDDING_PROVIDER=local` (default) | On by default; run `npm run embed:backfill` once for existing tickets | Duplicate detection finds a rephrased ticket |
