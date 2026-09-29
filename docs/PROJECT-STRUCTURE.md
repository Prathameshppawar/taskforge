# Project Structure

Where everything lives, what each folder is for, and where a new piece of code
belongs. For the reasoning behind the layering see
[ARCHITECTURE.md](ARCHITECTURE.md); for the data model see
[ER-DIAGRAM.md](ER-DIAGRAM.md).

## Contents

1. [Top level](#1-top-level)
2. [The layers](#2-the-layers)
3. [`src/features`: one line per feature](#3-srcfeatures-one-line-per-feature)
4. [`src/core/domain`: the pure rules](#4-srccoredomain-the-pure-rules)
5. [`src/infrastructure`, `src/lib`, `src/components`](#5-srcinfrastructure-srclib-srccomponents)
6. [Route map: pages](#6-route-map-pages)
7. [Route map: API](#7-route-map-api)
8. [Scripts, tests, evals and the MCP server](#8-scripts-tests-evals-and-the-mcp-server)
9. [Conventions](#9-conventions)
10. [Where to add things](#10-where-to-add-things)

---

## 1. Top level

```
.
├── .github/workflows/     ci.yml (lint, typecheck, domain, build, browser suite)
│                          uptime.yml (five-minute cron caller)
├── docs/                  this documentation, and images/ for the README
├── e2e/                   Playwright browser suite
├── evals/                 live-model Copilot evaluation
├── mcp/                   the MCP server (stdio), a thin client of the app
├── prisma/
│   ├── schema.prisma      79 models, 26 enums
│   ├── migrations/        hand-reviewed SQL, one folder per migration
│   └── seed.ts            roles, first admin, templates; demo data with SEED_DEMO=true
├── scripts/               domain suite, smoke test, embedding tools
├── src/                   the application
├── next.config.ts         security headers, server-external packages
├── prisma.config.ts       accepts DATABASE_URL_UNPOOLED as DIRECT_URL; seed command
├── playwright.config.ts   pinned to the Chrome channel
├── vercel.json            region sin1, the daily cron
├── .vercelignore          keeps .env* out of a CLI upload
├── .env.example           annotated local environment
├── .mcp.json.example      how to register the MCP server with a client
└── components.json        shadcn/ui generator settings
```

## 2. The layers

```
src/
├── app/              routing only: layouts, pages, route handlers
├── features/         vertical slices: actions, queries, services, components
├── core/domain/      framework-free rules; imports nothing from the layers above
├── infrastructure/   adapters: Prisma, AI providers, email, GitHub, Teams, passwords
├── components/       shared UI: ui/ (shadcn primitives) and shared/ (app widgets)
├── lib/              env contract, safe-action wrapper, utilities, PNG encoder
├── types/            ambient types (Auth.js session augmentation)
├── auth.ts           Auth.js: Credentials and SSO providers, session revalidation
├── auth.config.ts    edge-safe Auth.js config used by middleware
└── middleware.ts     route gate and the forced-password-change redirect
```

Dependencies point inward only:

```
app  →  features  →  core/domain
           ↓
     infrastructure  →  core/domain
```

`core/domain` imports nothing from Next.js, Prisma or React, which is why
`npm run verify` can assert its rules with no database, network or framework.

---

## 3. `src/features`: one line per feature

Files follow the naming in [section 9](#9-conventions): `actions.ts` (Server
Actions), `queries.ts` (reads), `service.ts` (server-side logic), `schemas.ts`
(Zod), `components/` (React).

| Folder | What it owns |
|---|---|
| `activity` | The audit writer (`recordActivity`, always inside the caller's transaction) and the activity timelines. |
| `admin` | People and sessions management UI (`user-manager`, `session-table`) used by Workspace → People and Sessions. |
| `agents` | AI agents as workspace users (`isAgent`): creating them, agent comments, and per-agent model choice. |
| `ai` | The Copilot: tool schemas (`tools.ts`), the trust boundary (`executor.ts`), name resolution (`resolver.ts`), the bounded loop and system prompt (`service.ts`), capture extraction, slash commands. |
| `ai-admin` | Workspace → AI: engines and sealed keys, model prices and the weekly catalogue refresh, the usage ledger wrapper, budgets and alerts, the weekly usage report. |
| `ai-fix` | "Fix with AI": the coding agent loop, the in-memory repository workspace, context assembly, CI failure reading, auto-heal and the autonomy policy (draft until green, auto-merge). |
| `ai-review` | AI review of a pull request against its ticket, posted as a GitHub review with inline comments. |
| `attachments` | Upload rules (5 MB, 20 per ticket), storage in `ticket_attachment_data`, and serving only to people who can see the ticket. |
| `auth` | Guards (`requireUser`, `requirePermission`, `requireProjectView`…), sign-in actions, lockout, welcome emails, and `acting-as.ts` for email and Teams acting as their sender. |
| `client-report` | The printable monthly client report: delivered, shipped, incidents, billable hours, and AI cost for staff. |
| `command` | The `⌘K` palette and its server-side search. |
| `cycles` | Sprints and milestones: planning actions, the backlog, burn-up read models, close with carry-over. |
| `dashboard` | Dashboard and Insights aggregates, computed in SQL. |
| `delivery` | DORA metrics per project from deployments, status history and incidents. |
| `errors` | Production error ingest: fingerprint grouping, regression detection, and the Production tickets Triage files. |
| `export` | Excel and CSV export of the current view, with formula-injection escaping. |
| `filters` | Filter criteria, saved filters, and "Describe a view" (natural language to filter). |
| `forecast` | Monte Carlo delivery forecasts for cycles, from eight weeks of throughput. |
| `github` | GitHub App manifest flow, installations, repositories, webhooks and reconciliation, deployments, personal GitHub authorisation, repository creation. |
| `import` | Import from Jira CSV, Trello JSON or any CSV, in batches, idempotent via `externalRef`. |
| `inbound-email` | Email in: IMAP polling of plus addresses, sender authentication, tickets and comments from mail, the email log. |
| `incidents` | Blameless post-mortem drafts for Production tickets, by TaskForge Ops. |
| `jobs` | The Postgres job queue: `enqueue`, `drain`, `queueSummary`, `retryFailed`. |
| `labels` | Label management and copying labels between projects. |
| `live` | The client component that polls `/api/live` and refreshes the page when a project changes. |
| `memory` | Project memory indexing (tickets, repository docs, handbook) and the handbook generator. |
| `monitors` | Uptime monitors, their checks, and the incidents they open and close. |
| `msteams` | The Teams bot conversation logic and the downloadable Teams app package. |
| `notifications` | In-app notifications (written in the caller's transaction), notification emails, the chime. |
| `portal` | The client portal: requests, previews, approvals. |
| `profile` | Profile, photo upload, role rim colours. |
| `projects` | Project creation from templates, workflow configuration (`config-actions.ts`), members, teams on projects, settings, landing views (`views.ts`). |
| `public-api` | The `/api/v1` REST handler over the Copilot's tools. |
| `recurring` | Recurring ticket schedules and generation. |
| `releases` | Release notes for Deployment tickets, by the Release Manager. |
| `reports` | The weekly update, the Monday manager digest and the opt-in daily digest. |
| `roles` | Role management and the seniority guards that stop privilege escalation. |
| `settings` | The personal Settings area as data (`modules.ts`). |
| `sso` | Keycloak, Google and Microsoft Entra ID providers, enabled by environment. |
| `teams` | Teams (groups of people), managers, and team-scoped delegation. |
| `tickets` | Ticket CRUD, bulk edits and undo, links, checklists, custom field values, transitions and entry rules, flow and SLA sweep, embeddings, estimates, triage suggestions, search. |
| `time` | Timers, time entries, the weekly timesheet. |
| `tokens` | Personal access tokens (hash only). |
| `triage-agent` | TaskForge Triage: fills a new ticket's defaults from project history, with undo. |
| `vercel` | Vercel token storage and Instant Rollback. |
| `webhooks-out` | Outbound webhooks: the outbox sweep over histories, signed deliveries through the job queue. |
| `workspace` | The Workspace administration area as data (`modules.ts`), each module naming its permission. |

---

## 4. `src/core/domain`: the pure rules

No imports from Next.js, Prisma or React. Everything here is asserted by
`scripts/verify-domain.ts`.

| File | Rules |
|---|---|
| `rbac.ts` | The permission catalogue, the three-layer check, seniority |
| `ticket-rules.ts` | Keys, the two-level hierarchy, progress rollup |
| `transitions.ts` | Entry requirements for statuses |
| `flow.ts` | SLA clocks (paused while blocked), time in status, stuck and WIP |
| `cycles.ts` | Burn-up replay, fill to capacity |
| `forecast.ts` | Seeded Monte Carlo forecast |
| `recurrence.ts` | Next-run arithmetic |
| `custom-fields.ts` | Value normalisation per field type |
| `ticket-templates.ts`, `ticket-context.ts`, `defaults.ts` | Templates by kind, context for agents, seeded defaults |
| `markdown.ts` | A Markdown parser that produces data, never HTML |
| `import.ts` | Jira, Trello and CSV parsing and mapping |
| `inbound-email.ts` | Plus-address routing, sender trust, loop protection, quote stripping |
| `msteams.ts` | Bot Framework token claim rules |
| `git-refs.ts` | Ticket keys in git text, forward-only status moves |
| `ai-fix.ts`, `auto-merge.ts`, `ci-workflow.ts`, `diff.ts` | Fix-run limits, the auto-merge policy, workflow checks, diff sizing |
| `ai-budget.ts`, `pricing.ts`, `engine-catalog.ts`, `agent-models.ts` | Cost arithmetic, alert thresholds, engine and model catalogue |
| `error-events.ts`, `releases.ts`, `dora.ts` | Error fingerprints, release sections, DORA metrics |
| `memory.ts` | Chunking for project memory |
| `time.ts` | Duration parsing (`1h 30m`, `1:30`) |
| `jobs.ts` | Queue backoff and stale-lock rule |
| `network.ts` | URL checks and private-address refusal for monitors and webhooks |
| `errors.ts`, `result.ts` | `DomainError` types and `ActionResult` |

`src/core/ports/` is empty and reserved.

## 5. `src/infrastructure`, `src/lib`, `src/components`

| Path | Contents |
|---|---|
| `infrastructure/db/prisma.ts` | The Prisma client, cached on `globalThis` in development |
| `infrastructure/ai/` | Provider adapters (`anthropic.ts`, `openai.ts`, `groq.ts`, `ollama.ts`), the provider factory, and `embedder.ts` (in-process sentence embeddings via `@xenova/transformers`) |
| `infrastructure/auth/password.ts` | bcrypt hashing |
| `infrastructure/email/mailer.ts` | nodemailer over SMTP |
| `infrastructure/github/client.ts` | GitHub App client without Octokit: app JWT, installation tokens, webhook verification |
| `infrastructure/github/secrets.ts` | `seal` / `unseal` (AES-256-GCM keyed from `AUTH_SECRET`), used for every stored credential |
| `infrastructure/msteams/client.ts` | Bot Framework client: JWT verification, Bot Connector replies, stored credentials |
| `lib/env.ts` | The server environment contract, validated lazily |
| `lib/safe-action.ts` | `runAction`: turns thrown errors into typed `ActionResult`s |
| `lib/png.ts` | PNG encoding for the generated app icons |
| `lib/utils.ts` | `cn` and small helpers |
| `components/ui/` | shadcn/ui primitives (button, dialog, select, table…) |
| `components/shared/` | App widgets: shell, sidebar, mobile nav, module nav, page header, avatars, pickers, Markdown editor and renderer, badges, theme toggle |

---

## 6. Route map: pages

`(app)` and `(auth)` are route groups and do not appear in URLs. Everything under
`(app)` is inside the signed-in shell (`app/(app)/layout.tsx`).

| URL | File | What |
|---|---|---|
| `/` | `app/page.tsx` | Redirects to `/dashboard` |
| `/login` | `app/(auth)/login/page.tsx` | Sign in, with SSO buttons when configured |
| `/dashboard` | `app/(app)/dashboard/page.tsx` | Workspace dashboard |
| `/my-tickets` | `app/(app)/my-tickets/page.tsx` | Tickets assigned to me |
| `/inbox` | `app/(app)/inbox/page.tsx` | Notifications |
| `/activity` | `app/(app)/activity/page.tsx` | Workspace activity |
| `/time` | `app/(app)/time/page.tsx` | Weekly timesheet |
| `/forbidden` | `app/(app)/forbidden/page.tsx` | No-access page |
| `/projects` | `app/(app)/projects/page.tsx` | Project list |
| `/projects/new` | `app/(app)/projects/new/page.tsx` | New project from a template |
| `/projects/[projectId]` | `…/[projectId]/page.tsx` | Redirects to the project's `defaultView` (Insights unless changed) |
| `/projects/[projectId]/insights` | `…/insights/page.tsx` | Project analytics, flow, DORA |
| `/projects/[projectId]/board` | `…/board/page.tsx` | Kanban |
| `/projects/[projectId]/plan` | `…/plan/page.tsx` | Backlog, sprints and milestones |
| `/projects/[projectId]/plan/[cycleId]` | `…/plan/[cycleId]/page.tsx` | One cycle: burn-up, forecast |
| `/projects/[projectId]/table` | `…/table/page.tsx` | Table view |
| `/projects/[projectId]/tree` | `…/tree/page.tsx` | Parent and child tree |
| `/projects/[projectId]/calendar` | `…/calendar/page.tsx` | Calendar |
| `/projects/[projectId]/timeline` | `…/timeline/page.tsx` | Timeline |
| `/projects/[projectId]/handbook` | `…/handbook/page.tsx` | The project handbook |
| `/projects/[projectId]/activity` | `…/activity/page.tsx` | Project activity |
| `/projects/[projectId]/members` | `…/members/page.tsx` | Members and attached teams |
| `/projects/[projectId]/labels` | `…/labels/page.tsx` | Labels |
| `/projects/[projectId]/recurring` | `…/recurring/page.tsx` | Recurring schedules |
| `/projects/[projectId]/settings` | `…/settings/page.tsx` | Project settings, workflow, repositories, automations |
| `/projects/[projectId]/import` | `…/import/page.tsx` | Import (redirects to the project if not permitted) |
| `/tickets/[ticketKey]` | `app/(app)/tickets/[ticketKey]/page.tsx` | The ticket page |
| `/settings` | `app/(app)/settings/page.tsx` | Profile |
| `/settings/notifications` | `…/settings/notifications/page.tsx` | Chime and email preferences |
| `/settings/security` | `…/settings/security/page.tsx` | Password |
| `/settings/tokens` | `…/settings/tokens/page.tsx` | Personal access tokens |
| `/settings/github` | `…/settings/github/page.tsx` | Personal GitHub connection |
| `/workspace` | `app/(app)/workspace/page.tsx` | Redirects to the first module the viewer may see, or `/forbidden` |
| `/workspace/people` | `…/workspace/people/page.tsx` | Users |
| `/workspace/roles` | `…/workspace/roles/page.tsx` | Roles and permissions |
| `/workspace/teams` | `…/workspace/teams/page.tsx` | Teams |
| `/workspace/templates` | `…/workspace/templates/page.tsx` | Project templates |
| `/workspace/ai` | `…/workspace/ai/page.tsx` | Engines, agents, prices, usage, budgets |
| `/workspace/integrations` | `…/workspace/integrations/page.tsx` | GitHub, Vercel, email in, Teams, webhooks, job queue |
| `/workspace/sessions` | `…/workspace/sessions/page.tsx` | Sign-in sessions |
| `/portal` | `app/portal/page.tsx` | Client portal |
| `/portal/report` | `app/portal/report/page.tsx` | Monthly client report |
| `/portal/tickets/[ticketKey]` | `app/portal/tickets/[ticketKey]/page.tsx` | A ticket as a client sees it |

Legacy URLs that redirect: `/admin/users` → `/workspace/people`, `/admin/roles`,
`/admin/teams`, `/admin/templates`, `/admin/sessions`, and `/settings/people`,
`/settings/roles`, `/settings/teams`, `/settings/templates`, `/settings/sessions`,
each to the matching `/workspace/*` page.

Also under `app/`: `layout.tsx` (root), `globals.css`, `icon.tsx`,
`apple-icon.tsx`, `manifest.ts` (installable app), `pwa-icon/[size]/route.ts`
(generated icons), and `(app)/error.tsx` and `(app)/not-found.tsx`.

## 7. Route map: API

| Path | Methods | Auth | What |
|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | — | Auth.js |
| `/api/cron/recurring` | GET | `CRON_SECRET` (Bearer or `?key=`) | Daily sweep; see [OPERATIONS.md](OPERATIONS.md#the-daily-cron-apicronrecurring) |
| `/api/cron/monitors` | GET | `CRON_SECRET` (Bearer only) | Five-minute sweep; see [OPERATIONS.md](OPERATIONS.md#the-five-minute-cron-apicronmonitors) |
| `/api/v1/projects` | GET | Access token | REST API |
| `/api/v1/tickets` | GET, POST | Access token | REST API |
| `/api/v1/tickets/[key]` | GET, PATCH | Access token | REST API |
| `/api/v1/tickets/[key]/comments` | POST | Access token | REST API |
| `/api/mcp` | GET, POST | Access token (or session) | The tool catalogue (GET) and tool calls (POST) the MCP server relays |
| `/api/github/webhook` | POST | GitHub signature | GitHub App webhook |
| `/api/github/manifest`, `/manifest/callback`, `/setup` | GET | Session, `integration:manage` | GitHub App creation and install |
| `/api/github/user/authorize`, `/user/callback` | GET | Session | Personal GitHub authorisation |
| `/api/msteams/messages` | POST | Bot Framework JWT | Teams bot endpoint |
| `/api/msteams/app-package` | GET | Session | Teams app zip |
| `/api/ingest/errors/[token]` | POST | Ingest secret in the path (stored hashed) | Production error ingest from a Sentry webhook or an app's error handler |
| `/api/attachments/[id]` | GET | Session, ticket visibility | Serves an attachment |
| `/api/avatars/[userId]` | GET | Session | Serves a profile photo |
| `/api/export/tickets` | GET | Session | Excel or CSV export |
| `/api/live` | GET | Session, project view | Live-update version |
| `/api/ai/transcribe` | POST | Session | Voice input for the Copilot |

The full contract, including Server Actions, is in [API.md](API.md).

---

## 8. Scripts, tests, evals and the MCP server

| Path | Run with | What |
|---|---|---|
| `scripts/verify-domain.ts` | `npm run verify` | Domain suite over `core/domain` and the tool contracts; no database or network |
| `scripts/smoke.sh` | `npm run smoke` | Signs in against a running server, walks every route, checks anonymous rejection, greps the server log for render errors |
| `scripts/verify-embeddings.ts` | `npm run verify:embeddings` | Semantic similarity and the embedding freshness invariant, against a real database |
| `scripts/embed-backfill.ts` | `npm run embed:backfill` | Resumable backfill of ticket embeddings |
| `e2e/*.spec.ts` | `npm run e2e` | Playwright: `layout` (scroll containment, five viewports), `forced-password-change`, `notifications`, `rbac`, `project-teams`; `helpers.ts` holds the overflow detector |
| `evals/cases.ts`, `evals/run.ts` | `npm run eval:ai` | Graded Copilot cases (routing, extraction, grounding, safety) against a live model; stops at the tool call |
| `mcp/server.ts` | `npm run mcp` | The stdio MCP server; reads `TASKFORGE_URL` and `TASKFORGE_TOKEN` and calls `/api/mcp`. See [MCP.md](MCP.md) |
| `prisma/seed.ts` | `npm run db:seed` | Roles, the first admin, templates; `SEED_DEMO=true` adds demo projects |

---

## 9. Conventions

**Where code goes**

| Kind of code | Place | Rule |
|---|---|---|
| A rule that needs no I/O | `core/domain/<topic>.ts` | Pure functions. Assert it in `scripts/verify-domain.ts`. |
| A mutation | `features/<slice>/actions.ts` | Always: guard → validate (Zod) → transact → audit (`recordActivity` in the same transaction) → revalidate. Wrapped in `runAction`, returning `ActionResult`. |
| A read for a page | `features/<slice>/queries.ts` | Server-only. Convert `Decimal` and `BigInt` to numbers or strings before anything reaches a Client Component. |
| Logic shared by actions, crons and agents | `features/<slice>/service.ts` | Takes a transaction client where it writes, so callers keep one transaction. |
| Validation | `features/<slice>/schemas.ts` | Zod. The Copilot's JSON Schemas are generated from these. |
| UI | `features/<slice>/components/` | Client Components only where interaction needs one. Shared widgets go to `components/shared/`. |
| A page | `app/(app)/…/page.tsx` | Thin: check access, call queries, compose components. |
| An adapter to the outside world | `infrastructure/<system>/` | No business rules. |

**`'use server'` files export only async functions.** Every `actions.ts` starts
with `'use server'`, and Next.js requires such a file to export nothing but async
functions: no constants, types used at runtime, schemas or helpers. Put those in
`schemas.ts`, `service.ts` or a plain module and import them. Exporting anything
else fails with "Only async functions are allowed to be exported in a 'use server'
file".

**Background work** goes through `enqueue` in `features/jobs/queue.ts` with a new
`JobKind` and a handler registered in `HANDLERS`, never a fire-and-forget promise.
A serverless function can be frozen the moment its response is sent.

**Raw SQL** is used only for what Prisma cannot express: full-text search,
embeddings, the job claim (`FOR UPDATE SKIP LOCKED`). Quote camelCase column names.

**Migrations** are hand-reviewed. See
[DEPLOYMENT.md](DEPLOYMENT.md#writing-a-migration).

**Every feature ships with its README entry.** A new feature adds a row to the
Features table in [README.md](../README.md), a section if it has behaviour worth
explaining, and a link to the file that carries the decision. A new environment
variable goes in `.env.example` and [ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md);
a new model goes in [ER-DIAGRAM.md](ER-DIAGRAM.md); a new cron step or opt-in
automation goes in [OPERATIONS.md](OPERATIONS.md).

## 10. Where to add things

| Task | Where |
|---|---|
| New business rule | `core/domain/`, then an assertion in `scripts/verify-domain.ts` |
| New mutation | `features/<slice>/actions.ts` |
| New read model | `features/<slice>/queries.ts` |
| New page | `app/(app)/…/page.tsx`; a project view also needs its segment in `features/projects/views.ts` if it should be a landing view |
| New workspace module | `features/workspace/modules.ts`, naming the permission that reveals it |
| New permission | `core/domain/rbac.ts`, plus a migration granting it to the roles that should have it |
| New Copilot tool | `features/ai/tools.ts` and `features/ai/executor.ts`; keep the tool payload under the token budget the domain suite asserts |
| New background job | `JobKind` and `HANDLERS` in `features/jobs/queue.ts` |
| New cron step | `app/api/cron/recurring/route.ts` (daily) or `app/api/cron/monitors/route.ts` (five-minute), with its own `.catch` so one failure does not hide the rest |
| New stored credential | `IntegrationSecret` with `seal()`, not a new plaintext column |
| New shared widget | `components/shared/` |
| New browser test | `e2e/`, using `helpers.ts` |
