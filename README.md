<div align="center">

# TaskForge

**An AI-first internal project & ticket management platform.**

Built for a single organisation, administered by one admin — not a multi-tenant SaaS.

`Next.js 15` · `TypeScript` · `PostgreSQL / Neon` · `Prisma` · `Auth.js` · `Tailwind` · `shadcn/ui` · `Groq` / `Ollama`

</div>

---

## What it is

TaskForge is a Linear/Jira-class ticketing system for internal teams. Work is
organised as **Project → Parent Ticket (feature) → Child Ticket (task)**, with
progress rolling up automatically from children to parents.

The distinguishing piece is the **AI Copilot**: a side panel that creates tickets,
breaks a feature into a parent plus its child tasks, searches in natural language,
moves tickets between statuses, and summarises project health — by calling the
exact same Server Actions the UI uses, so it inherits every permission check and
audit-log entry.

## Feature summary

| Area | Capabilities |
|---|---|
| **Auth** | Username + password (bcrypt), admin-provisioned accounts, admin password reset, activation/deactivation, JWT sessions with server-side invalidation, protected routes, role guards |
| **Roles** | Admin · Project Manager · User, plus per-project Manager/Member/Viewer scope |
| **Projects** | Name, code, description, status, dates, owner, members, labels, per-project settings, archive |
| **Templates** | Admin-authored blueprints carrying statuses, priorities, types, labels and a default parent/child ticket scaffold. "Create from Template" at project creation. |
| **Tickets** | Two-level hierarchy, unlimited children, progress rollup, parent status automation, tree view, sequential per-project keys (`AUTH-14`) |
| **Config** | Statuses, priorities and ticket types are project-scoped and fully admin-configurable |
| **Labels** | Project-specific, colour-coded, with "import from another project" |
| **Resources** | External links only (GitHub, SharePoint, Figma, Build, Docs, API Spec, Other) — no file storage |
| **Collaboration** | Threaded comments, edit/delete own, @mentions |
| **Audit** | Unified append-only timeline across tickets, projects, members and comments |
| **Views** | Table (TanStack), Kanban (dnd-kit), Calendar, Timeline, My Tickets, Dashboard |
| **Filters** | Project, assignee, status, priority, type, labels, date range, parent — savable as named filter sets |
| **Command palette** | `⌘K` / `Ctrl+K` — create, search, navigate, assign, transition |
| **AI Copilot** | Create · bulk-create parent+children · search · update · project insights · duplicate detection |
| **Automation** | Recurring tickets (daily → yearly) with auto-generation |
| **Analytics** | Completion %, trend, priority distribution, tickets by label, overdue, team workload |

## Keyboard

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette — search tickets and projects, run commands |
| `→` on a ticket | Open its quick actions (assign, change status) |
| `⌘J` / `Ctrl+J` | Toggle the AI Copilot |
| `G` then `D` / `T` / `P` / `A` / `S` | Go to Dashboard · My Tickets · Projects · Activity · Settings |
| `⌘↵` | Send a comment |

## Quick start

```bash
# 1. Install
npm install

# 2. Configure — see .env.example for what every variable means
cp .env.example .env
#    Fill in DATABASE_URL + DIRECT_URL from https://console.neon.tech
#    Generate a secret:  openssl rand -base64 32   ->  AUTH_SECRET

# 3. Create the schema
npm run db:migrate

# 4. Seed roles, templates and the admin account
npm run db:seed

# 5. Run
npm run dev
```

Add `SEED_DEMO=true` before step 4 to also create a demo workspace — two
projects built from templates, 38 tickets spread across the workflow, comments,
audit history and recurring schedules. Useful for evaluating the app; never run
it against production.

### Other commands

```bash
npm run verify      # 49 assertions over the domain — no DB, no network, <1s
npm run typecheck   # strict TypeScript, zero errors
npm run build       # production build
npm run db:studio   # browse the database
```

Sign in at <http://localhost:3000> with the `ADMIN_USERNAME` / `ADMIN_PASSWORD`
you set in `.env`.

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, the shape of a mutation, authorization model, AI design |
| [`docs/ER-DIAGRAM.md`](docs/ER-DIAGRAM.md) | Full entity relationship model, normalization notes, index coverage |
| [`docs/ENVIRONMENT-SETUP.md`](docs/ENVIRONMENT-SETUP.md) | **Start here** — exactly where to obtain every environment variable |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel + Neon deployment, cron setup, troubleshooting |
| [`docs/PROJECT-STRUCTURE.md`](docs/PROJECT-STRUCTURE.md) | Folder layout, the dependency rule, where to add things |
| [`.env.example`](.env.example) | Every environment variable, annotated with where to obtain it |

## How it is put together

A few decisions worth knowing before reading the code:

- **The domain is framework-free.** `src/core/domain` imports nothing from
  Next.js, Prisma or React, so the hierarchy rules, progress rollup, recurrence
  maths and permission matrix are directly testable — which is what
  `npm run verify` exercises.
- **Every mutation follows one path**: guard → validate → transact → audit →
  revalidate. The audit entry is written *inside* the same transaction as the
  change, so the timeline can never drift from the data.
- **The AI Copilot has no privileged access.** The model emits a typed tool
  call; it is validated with Zod and dispatched to the same Server Actions the
  UI uses. It inherits every permission check and audit entry, and cannot do
  anything the signed-in user could not do by hand.
- **Filters live in the URL**, so every view is shareable and the back button
  behaves.
- **Chart colours are validated, not chosen by eye** — the palette passes
  colourblind-separation and contrast checks in both light and dark.

## Licence

Internal project. All rights reserved.
