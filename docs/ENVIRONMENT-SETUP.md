# Environment setup

Every environment variable TaskForge reads, what it does, whether you need it,
its default, where to get it, and whether it is a secret. The list was taken from
the code (`src/lib/env.ts`, every `process.env.` in `src/`, `prisma/`,
`scripts/`, `mcp/`, `prisma.config.ts`), not from memory.

Three variables are required: `DATABASE_URL`, `AUTH_SECRET` and, for anything
scheduled, `CRON_SECRET`. Everything else is optional and either has a working
default or switches a feature on.

Everything here can be run on free tiers: Neon, Vercel Hobby, Groq, Gmail,
GitHub, the Teams Developer Portal and Keycloak all cost nothing at the scale of
a team. Where a free tier has a ceiling that matters, it is said below or in
[INTEGRATIONS.md](INTEGRATIONS.md).

## Contents

- [Quick start](#quick-start)
- [What is stored in the database instead](#what-is-stored-in-the-database-instead)
- [1. Application](#1-application)
- [2. Database](#2-database)
- [3. Authentication and sessions](#3-authentication-and-sessions)
- [4. The first administrator (seed)](#4-the-first-administrator-seed)
- [5. Email out (SMTP) and email in (IMAP)](#5-email-out-smtp-and-email-in-imap)
- [6. AI engines](#6-ai-engines)
- [7. Semantic similarity (embeddings)](#7-semantic-similarity-embeddings)
- [8. GitHub](#8-github)
- [9. Scheduled jobs (cron)](#9-scheduled-jobs-cron)
- [10. Single sign-on](#10-single-sign-on)
- [11. Microsoft Teams test hooks (development only)](#11-microsoft-teams-test-hooks-development-only)
- [12. MCP server (runs on your machine)](#12-mcp-server-runs-on-your-machine)
- [13. Set by the platform](#13-set-by-the-platform)
- [14. Test and CI only](#14-test-and-ci-only)
- [Rotating AUTH_SECRET](#rotating-auth_secret)
- [Checking it worked](#checking-it-worked)
- [What each failure looks like](#what-each-failure-looks-like)

---

## Quick start

```bash
cp .env.example .env
# set DATABASE_URL, DIRECT_URL, AUTH_SECRET and CRON_SECRET (see below)
npm run db:migrate    # creates the tables
npm run db:seed       # roles, templates and the first administrator
npm run dev
```

`SEED_DEMO=true npm run db:seed` also creates a demo project with tickets.

On Vercel, add each variable under **Project → Settings → Environment
Variables**. Never commit the real `.env`.

The server validates its variables the first time one is read, not at build
time, so `next build` works with an empty environment. A missing or malformed
required value fails the first request with `Invalid environment configuration`
and names the variable.

---

## What is stored in the database instead

Several credentials are **not** environment variables. They are entered in the
UI, stored in Postgres and sealed with AES-256-GCM under a key derived from
`AUTH_SECRET` (`src/infrastructure/github/secrets.ts`). A database dump alone
does not reveal them.

| Credential | Entered on | Stored in |
|---|---|---|
| GitHub App id, private key, webhook secret, client id and secret | Workspace → Integrations → Create GitHub App (manifest flow) | `GithubApp` |
| A person's GitHub user token and refresh token | Settings → GitHub → Connect GitHub | `GithubUserToken` |
| AI engine API keys (any engine in the catalogue) | Workspace → AI | `AiEngineSetting` |
| Vercel token and team id | Workspace → Integrations → Vercel | `IntegrationSecret` (`vercel`) |
| Microsoft Teams bot id, tenant id and client secret | Workspace → Integrations → Microsoft Teams | `IntegrationSecret` (`msteams`) |
| Outbound webhook signing secrets | Workspace → Integrations → API and webhooks | `OutboundWebhook` |

Two more secrets are stored only as a SHA-256 hash and cannot be read back:
personal access tokens (Settings → Access tokens) and each project's error
intake URL (project settings).

Anything sealed becomes unreadable if `AUTH_SECRET` changes. See
[Rotating AUTH_SECRET](#rotating-auth_secret).

---

## 1. Application

| Variable | Required | Default | Secret |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Recommended in production | none | No |
| `NEXT_PUBLIC_APP_NAME` | No | `TaskForge` | No |
| `NODE_ENV` | Set by Next.js | `development` | No |

**`NEXT_PUBLIC_APP_URL`** is the public base URL, such as
`https://taskforge.example.com`, with no trailing slash. It builds the absolute
links in emails (notifications, digests, the weekly AI usage report, budget
alerts) and in outbound webhook payloads (`ticket.url`). Notification emails fall
back to `AUTH_URL` when it is unset; the usage report and budget alerts do not,
so their links come out relative. Set it in production.

**`NEXT_PUBLIC_APP_NAME`** is the product name shown in the UI, in the From name
of outgoing email (when `EMAIL_FROM` is unset) and in the Teams app package.

**`NODE_ENV`** is set by `next dev` (`development`) and `next start` / Vercel
(`production`). You do not set it. It controls Prisma's log level and whether the
[Teams test hooks](#11-microsoft-teams-test-hooks-development-only) are honoured.

---

## 2. Database

| Variable | Required | Default | Secret |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | none | **Yes** |
| `DIRECT_URL` | For migrations | falls back, see below | **Yes** |
| `DATABASE_URL_UNPOOLED` | No | none | **Yes** |

**`DATABASE_URL`** is the **pooled** Postgres connection string. The app uses it
at runtime. On Neon the host contains `-pooler`; PgBouncer is what keeps
serverless functions under Neon's connection limit.

**`DIRECT_URL`** is the **direct** (unpooled) string. Only the Prisma CLI reads
it (`migrate`, `db push`); the running app never does. Migrations take advisory
locks that do not survive transaction pooling, so they need the direct host.

**`DATABASE_URL_UNPOOLED`** is what Neon's Vercel integration names the direct
string. `prisma.config.ts` copies it into `DIRECT_URL` when `DIRECT_URL` is
unset, so you do not need to rename it. If neither is set, the CLI falls back to
`DATABASE_URL` and prints a warning when that is the pooled host.

### Getting the strings from Neon (free tier)

**Through Vercel.** Vercel → Storage (or the Neon listing on the Vercel
Marketplace) → Install → pick a region → Connect Project, ticking Development,
Preview and Production. It sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`; both
work as they are.

**By hand.**

1. Sign in at <https://console.neon.tech> and create a project in the region
   nearest your team.
2. Press **Connect**. The "Connect to your database" modal has a **Connection
   pooling** toggle.
3. Toggle **on**: the host contains `-pooler`. That is `DATABASE_URL`.
4. Toggle **off**: no `-pooler`. That is `DIRECT_URL`.
5. Make sure both end in `?sslmode=require`.

```
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.region.aws.neon.tech/taskforge?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/taskforge?sslmode=require"
```

Any Postgres works; CI uses a plain `postgres:` service with the same string in
both variables.

---

## 3. Authentication and sessions

| Variable | Required | Default | Secret |
|---|---|---|---|
| `AUTH_SECRET` | **Yes** (16+ characters) | none | **Yes** |
| `AUTH_URL` | Self-hosting / behind a proxy | inferred on Vercel | No |
| `AUTH_TRUST_HOST` | No | not needed | No |
| `SESSION_MAX_AGE` | No | `28800` (8 hours) | No |
| `BCRYPT_ROUNDS` | No | `12` (allowed 8 to 15) | No |

**`AUTH_SECRET`** signs and encrypts session cookies (Auth.js v5), and is the
root of the key that seals every stored integration credential. Generate one:

```bash
openssl rand -base64 32     # or: npx auth secret
```

Use a different value locally and in production, and never commit it. Changing
it signs everyone out and makes sealed credentials unreadable; see
[Rotating AUTH_SECRET](#rotating-auth_secret).

**`AUTH_URL`** is the canonical URL of the deployment, read by Auth.js. Optional
on Vercel; set it when self-hosting or behind a proxy. Notification emails also
use it for links when `NEXT_PUBLIC_APP_URL` is unset.

**`AUTH_TRUST_HOST`** appears in `.env.example`, but the Auth.js config already
sets `trustHost: true` in code (`src/auth.config.ts`), so it changes nothing.

**`SESSION_MAX_AGE`** is the session lifetime in seconds. Independently of it, a
live session is re-checked against the database at most every five minutes, so a
deactivated account or an admin password reset takes effect within five minutes.

**`BCRYPT_ROUNDS`** is the bcrypt cost for password hashes, used by the app and
by the seed scripts. Values outside 8 to 15 fail validation. CI uses 8 because
the suite signs in constantly; use 12 in production.

---

## 4. The first administrator (seed)

Read only by `npm run db:seed` (`prisma/seed.ts`). You choose these values; they
are not obtained from anywhere.

| Variable | Required | Default | Secret |
|---|---|---|---|
| `ADMIN_USERNAME` | No | `admin` | No |
| `ADMIN_EMAIL` | No | `admin@taskforge.local` | No |
| `ADMIN_NAME` | No | `Platform Admin` | No |
| `ADMIN_PASSWORD` | Strongly recommended | `ChangeMe!2024` | **Yes** |
| `SEED_DEMO` | No | unset | No |

The seed creates exactly one Admin account. If a user with `ADMIN_USERNAME`
already exists it is left alone, password included, so re-running the seed is
safe. When `ADMIN_PASSWORD` is **not** set, the default password is used and the
account must change it at first sign-in. Use the real email of the person who
will administer the workspace: single sign-on and email in both match accounts by
email.

**`SEED_DEMO=true`** also creates a demo project with tickets.

---

## 5. Email out (SMTP) and email in (IMAP)

Optional. Without SMTP nothing is emailed: new users get no welcome email (the
admin passes the password on), the bell still shows notifications, managers get
no digest, and report subscriptions on Workspace → AI are saved but not sent.
Setup and behaviour are in [INTEGRATIONS.md → Email](INTEGRATIONS.md#email-out-smtp).

| Variable | Required | Default | Secret |
|---|---|---|---|
| `EMAIL_HOST` | For any email | none | No |
| `EMAIL_PORT` | No | `587` | No |
| `EMAIL_USER` | For any email | none | No |
| `EMAIL_PASS` | For any email | none | **Yes** |
| `EMAIL_FROM` | No | `<NEXT_PUBLIC_APP_NAME> <EMAIL_USER>` | No |
| `IMAP_HOST` | No | `EMAIL_HOST` with `smtp.` replaced by `imap.` | No |
| `IMAP_PORT` | No | `993` | No |

Email counts as configured only when `EMAIL_HOST`, `EMAIL_USER` and `EMAIL_PASS`
are all set.

- **`EMAIL_HOST`**: the SMTP server, such as `smtp.gmail.com`.
- **`EMAIL_PORT`**: `587` upgrades with STARTTLS; `465` uses implicit TLS. Any
  other port connects without implicit TLS.
- **`EMAIL_USER`** and **`EMAIL_PASS`**: the SMTP login. For Gmail use an **app
  password** (Google Account → Security → App passwords, which needs 2-Step
  Verification), never the account password. Gmail is free; its sending limits
  are generous for a team.
- **`EMAIL_FROM`**: the From header, such as `TaskForge <you@gmail.com>`.

**Email in** reads the same mailbox over IMAP with the same `EMAIL_USER` and
`EMAIL_PASS`. `EMAIL_USER` must be a full address (`name@domain`), because the
plus addresses are built from it. `IMAP_HOST` is needed only when the IMAP host
is not simply the SMTP host with `smtp.` swapped for `imap.`
(`smtp.gmail.com` → `imap.gmail.com` works without it). Port `993` connects with
TLS; any other port connects without it. Email in is then switched on in
Workspace → Integrations and per project; nothing is read until it is.

---

## 6. AI engines

Optional. The app works without any AI; the Copilot panel explains what to
configure instead of failing.

There are two layers:

- **Environment variables** below, which give a default setup with no clicks.
- **Workspace → AI** (permission `ai:manage`), where an administrator can connect
  any engine in the catalogue, paste its key, choose models and assign engines to
  agents. Settings saved there **win over the environment**; a saved key is
  sealed with `AUTH_SECRET`. If a saved key can no longer be unsealed, the
  engine falls back to its environment key.

### The Copilot's provider

| Variable | Required | Default | Secret |
|---|---|---|---|
| `AI_PROVIDER` | No | `none` | No |
| `AI_MAX_TOKENS` | No | `2048` | No |
| `GROQ_API_KEY` | When `AI_PROVIDER=groq` | none | **Yes** |
| `GROQ_MODEL` | No | `openai/gpt-oss-120b` | No |
| `OLLAMA_BASE_URL` | When `AI_PROVIDER=ollama` | `http://127.0.0.1:11434` | No |
| `OLLAMA_MODEL` | No | `llama3.1` | No |

**`AI_PROVIDER`** is `groq`, `ollama` or `none`. It is used only when no Copilot
engine has been chosen on Workspace → AI. `groq` needs `GROQ_API_KEY`; `ollama`
needs a reachable Ollama server.

**`AI_MAX_TOKENS`** caps the length of a response from Groq and Ollama when the
caller does not set its own limit.

**`GROQ_API_KEY`**: <https://console.groq.com/keys> → Create API Key. Groq shows
it once. Free tier with no card, rate-limited per minute and per day. The same key
makes Groq available to Fix with AI and the other agents. Voice input's fallback
transcription (Whisper on Groq, for browsers without built-in speech recognition)
needs both `AI_PROVIDER=groq` and this key; a key saved only on Workspace → AI is
not enough for it.

**`GROQ_MODEL`**: Groq retires models from time to time. If you see "model not
found", list the current ones and pick a tool-calling model:

```bash
curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

**`OLLAMA_BASE_URL`** / **`OLLAMA_MODEL`**: local inference, no key and no cost.
`ollama serve`, then `ollama pull llama3.1`. Ollama cannot work from Vercel: a
serverless function cannot reach `127.0.0.1` on your laptop. Use it locally and
Groq (or another engine) when deployed.

### Engines for Fix with AI and the agents

| Variable | Required | Default | Secret |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | none | **Yes** |
| `ANTHROPIC_MODEL` | No | `claude-opus-5` | No |
| `OPENAI_API_KEY` | No | none | **Yes** |
| `OPENAI_MODEL` | No | `gpt-5` | No |

Each engine with a key is offered. Without a chosen default on Workspace → AI,
they are ordered most capable first (Anthropic, OpenAI, then the rest of the
catalogue, Groq among them). With no usable engine, the Fix with AI button does
not appear.

- **`ANTHROPIC_API_KEY`**: <https://console.anthropic.com/settings/keys>.
  **Paid only**, no free tier.
- **`OPENAI_API_KEY`**: <https://platform.openai.com/api-keys>. **Paid only**.

To stay on free tiers, leave these two unset and use Groq, or connect one of the
free engines below on Workspace → AI.

### The engine catalogue

`src/core/domain/engine-catalog.ts` lists every engine. Only three have an
environment variable (`envKey`); every other key is entered on Workspace → AI.
Free-tier notes are the catalogue's own, checked in September 2026; the
provider's page is the source of truth.

| Engine | Key from | Env variable | Free tier | Requests processed in |
|---|---|---|---|---|
| Anthropic | console.anthropic.com/settings/keys | `ANTHROPIC_API_KEY` | None | United States |
| OpenAI | platform.openai.com/api-keys | `OPENAI_API_KEY` | None | United States |
| Google Gemini | aistudio.google.com/apikey | UI only | Permanent, no card (about 1,500 requests a day on Flash) | United States; free-tier prompts may be used for training |
| DeepSeek | platform.deepseek.com/api_keys | UI only | None (low cost) | China |
| Groq | console.groq.com/keys | `GROQ_API_KEY` | Permanent, no card, rate-limited | United States |
| Zhipu GLM (Z.ai) | open.bigmodel.cn/usercenter/apikeys | UI only | Permanent (the `-Flash` models, one request at a time) | China |
| Moonshot Kimi | platform.moonshot.ai/console/api-keys | UI only | None (low cost) | China |
| Alibaba Qwen (DashScope) | modelstudio.console.alibabacloud.com | UI only | New-account credits, then paid | Singapore (international endpoint) |
| SiliconFlow | cloud.siliconflow.cn/account/ak | UI only | Permanent for several small models, after identity verification | China |
| Alibaba ModelScope | modelscope.cn/my/myaccesstoken | UI only | Permanent (about 2,000 requests a day, Alibaba Cloud account linked) | China |
| OpenRouter | openrouter.ai/settings/keys | UI only | Models ending `:free` (20 a minute, 50 a day) | Varies by the model routed to |
| NVIDIA NIM | build.nvidia.com/settings/api-keys | UI only | Permanent with a developer account (about 40 a minute) | United States |
| Mistral | console.mistral.ai/api-keys | UI only | Free "Experiment" plan, rate-limited | European Union |
| Cerebras | cloud.cerebras.ai/platform | UI only | Permanent, daily token limits | United States |
| Any OpenAI-compatible endpoint | wherever you point it | UI only (base URL too) | Depends | Wherever you point it |

Fix with AI sends repository code and ticket text to the engine. For a client's
codebase, where requests are processed and whether free-tier prompts are used for
training are decisions to make on purpose.

---

## 7. Semantic similarity (embeddings)

| Variable | Required | Default | Secret |
|---|---|---|---|
| `EMBEDDING_PROVIDER` | No | `local` | No |
| `TRANSFORMERS_CACHE` | No | see below | No |

**`EMBEDDING_PROVIDER`**: `local` runs a small embedding model
(`Xenova/bge-small-en-v1.5`) in-process, with no key and no per-call cost; the
weights are downloaded once per process. `none` switches it off, and duplicate
detection and related searches fall back to lexical matching.

**`TRANSFORMERS_CACHE`**: where the model weights are cached. Unset, the cache is
`/tmp/transformers` on Vercel or AWS Lambda (the only writable directory there)
and `./.cache/transformers` elsewhere.

---

## 8. GitHub

**Nothing to set for the normal path.** Workspace → Integrations → Create GitHub
App creates the app through GitHub's manifest flow and stores its credentials in
the database, sealed. See [INTEGRATIONS.md → GitHub App](INTEGRATIONS.md#github-app).

| Variable | Required | Default | Secret |
|---|---|---|---|
| `GITHUB_APP_ID` | No | none | No |
| `GITHUB_APP_SLUG` | No | empty | No |
| `GITHUB_APP_PRIVATE_KEY` | No | none | **Yes** |
| `GITHUB_WEBHOOK_SECRET` | No | none | **Yes** |
| `GITHUB_CLIENT_ID` | No | the stored app's | No |
| `GITHUB_CLIENT_SECRET` | No | the stored app's | **Yes** |
| `GITHUB_WEBHOOK_URL` | No | this deployment's own URL, if public | No |

**Pinning an app from the environment.** When `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` are **all three** set, they
take precedence over the stored app, so a production deployment can pin its app
without depending on database state and rotate the key by redeploying. Take the
values from the app's settings on GitHub (App ID; Private keys → Generate; the
webhook secret you set). `GITHUB_APP_PRIVATE_KEY` is the PEM; literal `\n`
sequences are turned into newlines, which is how Vercel stores multi-line values.
`GITHUB_APP_SLUG` is the app's URL name.

**`GITHUB_CLIENT_ID`** / **`GITHUB_CLIENT_SECRET`** are the app's OAuth client
credentials, used when a person connects their own GitHub account (Settings →
GitHub) to create repositories. With both set they are used; otherwise the stored
app's are. Set them when the app is pinned from the environment, because a pinned
app has no stored client credentials.

**`GITHUB_WEBHOOK_URL`** is where GitHub should deliver webhooks when this
deployment's own address is not public, typically a tunnel in development
(`ngrok http 3000` → `https://xxxx.ngrok-free.app/api/github/webhook`). It is read
when the app is created. The address can be changed later on the Integrations
page without it.

---

## 9. Scheduled jobs (cron)

| Variable | Required | Default | Secret |
|---|---|---|---|
| `CRON_SECRET` | **Yes**, for anything scheduled | none | **Yes** |

The shared secret guarding both cron endpoints. Generate it:

```bash
openssl rand -hex 32
```

Without it both endpoints answer `503` and nothing scheduled runs; the rest of
the app is unaffected.

| Endpoint | Called by | What it does |
|---|---|---|
| `GET /api/cron/recurring` | Vercel Cron, daily at 06:00 UTC (`vercel.json`) | Recurring tickets, embedding sweep, GitHub reconciliation, daily digests, memory indexing, job queue; on Mondays also the manager digest, weekly AI usage report, model price refresh and handbooks |
| `GET /api/cron/monitors` | `.github/workflows/uptime.yml`, every five minutes | Uptime monitors, SLA alerts, email in, outbound webhook sweep, job queue |

Both take `Authorization: Bearer <CRON_SECRET>`, which is what Vercel Cron sends.
`/api/cron/recurring` also accepts `?key=<CRON_SECRET>` for schedulers that
cannot set headers; `/api/cron/monitors` accepts the header only.

The five-minute schedule runs on GitHub Actions because Vercel Cron runs at most
daily on the Hobby plan. The workflow needs two **repository secrets** (GitHub →
repository → Settings → Secrets and variables → Actions), not deployment
variables:

| Secret | Value |
|---|---|
| `TASKFORGE_URL` | The production base URL, such as `https://taskforge.example.com` |
| `CRON_SECRET` | The same value as the deployment's `CRON_SECRET` |

If either is missing the workflow prints a notice and exits successfully, doing
nothing. See [INTEGRATIONS.md → Uptime monitors](INTEGRATIONS.md#uptime-monitors)
for the free-tier minutes this uses.

---

## 10. Single sign-on

Optional. Each button appears on the sign-in page only when its keys are set. No
provider creates accounts: a sign-in is accepted only for an existing, active,
human account whose email the provider has verified. Setup is in
[INTEGRATIONS.md → Single sign-on](INTEGRATIONS.md#single-sign-on).

| Variable | Required | Default | Secret |
|---|---|---|---|
| `KEYCLOAK_ISSUER` | For Keycloak | none | No |
| `KEYCLOAK_CLIENT_ID` | For Keycloak | none | No |
| `KEYCLOAK_CLIENT_SECRET` | For Keycloak | none | **Yes** |
| `KEYCLOAK_LABEL` | No | `Keycloak` | No |
| `AUTH_GOOGLE_ID` | For Google | none | No |
| `AUTH_GOOGLE_SECRET` | For Google | none | **Yes** |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | For Microsoft | none | No |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | For Microsoft | none | **Yes** |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Recommended for Microsoft | none | No |

- **Keycloak** needs all three of issuer, client id and client secret.
  `KEYCLOAK_ISSUER` is the realm's issuer URL,
  `https://auth.example.com/realms/<realm>`. `KEYCLOAK_LABEL` is the button text,
  such as `Company login`. Redirect URI: `<site>/api/auth/callback/keycloak`.
- **Google** needs both id and secret, from Google Cloud Console → APIs &
  Services → Credentials → OAuth client ID (web application). Redirect URI:
  `<site>/api/auth/callback/google`.
- **Microsoft Entra ID** needs both id and secret, from an app registration in
  the Entra admin centre. `AUTH_MICROSOFT_ENTRA_ID_ISSUER` is
  `https://login.microsoftonline.com/<tenant-id>/v2.0`, which keeps sign-in to
  your organisation's accounts. Redirect URI:
  `<site>/api/auth/callback/microsoft-entra-id`.

---

## 11. Microsoft Teams test hooks (development only)

The Teams bot's real credentials are entered in the UI, not here. These two
variables exist for local end-to-end testing without a Microsoft 365 tenant.
**They are ignored unless `NODE_ENV` is `development`**, which `next dev` sets and
a deployment never does, so production always talks to Microsoft and always
checks Microsoft's signing keys.

| Variable | Required | Default | Secret |
|---|---|---|---|
| `MSTEAMS_TEST_CONNECTOR` | No | none | No |
| `MSTEAMS_TEST_JWKS` | No | none | No |

- **`MSTEAMS_TEST_CONNECTOR`**: the base URL of a mock Bot Connector. Activities
  whose `serviceUrl` starts with it are accepted, replies are sent to it, and the
  bot uses a fixed test token instead of asking Microsoft for one.
- **`MSTEAMS_TEST_JWKS`**: a JSON key set (`{"keys":[...]}`) used instead of Bot
  Framework's published keys to verify incoming tokens, so a test can sign its
  own.

---

## 12. MCP server (runs on your machine)

Read by `mcp/server.ts`, the stdio bridge an MCP client launches locally. They go
in the MCP client's configuration, not in the deployment. See [MCP.md](MCP.md).

| Variable | Required | Default | Secret |
|---|---|---|---|
| `TASKFORGE_URL` | **Yes** | none | No |
| `TASKFORGE_TOKEN` | **Yes** | none | **Yes** |
| `TASKFORGE_PROJECT` | No | none | No |

- **`TASKFORGE_URL`**: the deployed app's base URL.
- **`TASKFORGE_TOKEN`**: a personal access token from Settings → Access tokens.
  Every call has that person's permissions.
- **`TASKFORGE_PROJECT`**: a project code sent with every tool call as the
  default project.

(The uptime workflow's `TASKFORGE_URL` is a separate GitHub repository secret
with the same meaning.)

---

## 13. Set by the platform

You do not set these; the code reads them.

| Variable | Set by | Used for |
|---|---|---|
| `VERCEL` | Vercel | Choosing `/tmp/transformers` for the embedding model cache |
| `AWS_LAMBDA_FUNCTION_NAME` | AWS Lambda | The same |
| `NODE_ENV` | Next.js | See [Application](#1-application) |

---

## 14. Test and CI only

Read by `playwright.config.ts` and set in `.github/workflows/ci.yml`; the app
itself does not read them.

| Variable | Used for |
|---|---|
| `CI` | Playwright: two workers, GitHub reporter, never reuse a running server |
| `E2E_BASE_URL` | Run the browser suite against an existing server instead of building one |
| `E2E_USERNAME`, `E2E_PASSWORD` | The account the browser suite signs in with |
| `NEXTAUTH_URL` | Set in CI next to `AUTH_URL`; the code does not read it |

The Playwright server starts with `EMAIL_HOST` blank, so a test run emails no
seed address even when `.env` has real SMTP settings.

---

## Rotating AUTH_SECRET

Changing `AUTH_SECRET` is the emergency lever if sessions may have been
compromised. It also changes the key that seals stored credentials. After a
rotation:

| What | Effect | Fix |
|---|---|---|
| Sessions | Everyone is signed out | Sign in again |
| GitHub App | The integrations page reports the stored app could not be unsealed | Disconnect the app on Workspace → Integrations and create a new one (the old app stays on GitHub until its owner deletes it) |
| People's GitHub connections | Cannot be read | Each person reconnects in Settings → GitHub |
| AI engine keys saved on Workspace → AI | Fall back to the environment key, if any | Paste the keys again |
| Vercel token, Teams bot secret | Cannot be read | Enter them again on Workspace → Integrations |
| Outbound webhook secrets | Deliveries fail | Delete and re-create each webhook, and give the receiver the new secret |

A GitHub App pinned through `GITHUB_APP_*` variables is unaffected. Personal
access tokens and error intake URLs are hashed, not sealed, so they keep working.

---

## Checking it worked

```bash
npm run dev > /tmp/tf.log 2>&1 &
npm run smoke -- http://localhost:3000 admin '<your ADMIN_PASSWORD>' /tmp/tf.log
```

That signs in for real, walks every route and checks the server log for render
errors.

To check the cron secret against a deployment:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-site>/api/cron/monitors
```

## What each failure looks like

| Symptom | Cause |
|---|---|
| `prisma migrate` hangs with no output | `DIRECT_URL` is the pooled host, or it and `DATABASE_URL_UNPOOLED` are both unset and `DATABASE_URL` is pooled |
| `Invalid environment configuration` on the first request | A required variable is missing or malformed; the message names it (`AUTH_SECRET` shorter than 16 characters, `BCRYPT_ROUNDS` outside 8 to 15, `AI_PROVIDER` not `groq`/`ollama`/`none`, `AUTH_URL` not a URL) |
| Signed out immediately after signing in | `AUTH_SECRET` is unset, or differs between build and runtime |
| `Can't reach database server` | Wrong password in the URL, or `?sslmode=require` missing |
| `too many connections` | The **direct** URL is being used as `DATABASE_URL` |
| Copilot says it is not configured | No Copilot engine on Workspace → AI, and `AI_PROVIDER` is `none` or its key is missing |
| "model not found" from Groq | `GROQ_MODEL` has been retired; list the current models |
| Cron endpoints return `503` | `CRON_SECRET` is not set on the deployment |
| Cron endpoints return `401` | The secret sent does not match, or `/api/cron/monitors` was called with `?key=` instead of the header |
| Uptime workflow succeeds but nothing happens | `TASKFORGE_URL` or `CRON_SECRET` repository secret missing; the log says so |
| No emails at all | One of `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS` is missing |
| "Email is not configured" on email in | SMTP incomplete, `EMAIL_USER` not a full address, or no IMAP host could be derived |
| SSO button missing | One of that provider's required variables is unset |
| "The stored GitHub App could not be unsealed" | `AUTH_SECRET` changed since the app was created |
