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

Sign in at <http://localhost:3000> with the `ADMIN_USERNAME` / `ADMIN_PASSWORD`
you set in `.env`.

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, the shape of a mutation, authorization model, AI design |
| [`docs/ER-DIAGRAM.md`](docs/ER-DIAGRAM.md) | Full entity relationship model, normalization notes, index coverage |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel + Neon deployment, cron setup, production checklist |
| [`.env.example`](.env.example) | Every environment variable, annotated with where to obtain it |

## Licence

Internal project. All rights reserved.
