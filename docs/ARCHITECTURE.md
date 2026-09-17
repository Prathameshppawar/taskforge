# TaskForge — Architecture

## 1. Guiding decisions

| Decision | Choice | Rationale |
|---|---|---|
| Rendering | Next.js 15 App Router, Server Components by default | Data fetching lives next to the UI that needs it; client bundles stay small. Only interactive leaves (`Kanban`, `DataTable`, `Copilot`) are `"use client"`. |
| Mutations | Server Actions | No hand-written REST layer for internal operations. Every action is typed end-to-end and returns a discriminated `ActionResult`. |
| Route Handlers | Only for non-form surfaces | `/api/auth/*` (Auth.js), `/api/ai/chat` (streaming), `/api/cron/recurring` (scheduler). Everything else is a Server Action. |
| Data access | Repository pattern behind ports | Feature services depend on interfaces in `core/ports`, never on Prisma directly. Swapping the ORM touches one folder. |
| Authorization | Typed permission matrix + project scope | Role *assignment* is relational; role *policy* is compile-time checked TypeScript. One source of truth, zero DB round-trips to authorize. |
| Workflow config | Project-scoped, seeded from templates | Every project owns its statuses/priorities/types/labels, so boards differ per project without nullable-FK ambiguity. |

## 2. Layers

```
┌──────────────────────────────────────────────────────────────┐
│  app/            Routing, layouts, pages (Server Components)  │
├──────────────────────────────────────────────────────────────┤
│  features/*/     Feature slices                               │
│    ├── actions/    "use server" entry points  (transaction    │
│    │               boundary + authorization + audit)          │
│    ├── schemas/    Zod contracts, shared by form and action   │
│    ├── services/   Orchestration, business rules              │
│    ├── queries/    Read models for the UI                     │
│    └── components/ Feature-owned UI                           │
├──────────────────────────────────────────────────────────────┤
│  core/           Framework-free domain                        │
│    ├── domain/     Entities, rules, RBAC, errors, Result      │
│    └── ports/      Repository interfaces                      │
├──────────────────────────────────────────────────────────────┤
│  infrastructure/ Adapters                                     │
│    ├── db/         Prisma client                              │
│    ├── repositories/ Port implementations                     │
│    ├── auth/       Auth.js configuration                      │
│    └── ai/         Groq + Ollama providers behind one port    │
└──────────────────────────────────────────────────────────────┘
```

Dependency rule: **inward only**. `core` imports nothing from `features`, `app` or
`infrastructure`. This is what makes the domain rules (`ticket-rules.ts`,
`recurrence.ts`, `rbac.ts`) directly unit-testable with no database.

## 3. The shape of a mutation

Every write follows the same path, which is why auditing and authorization are
impossible to forget:

```
Client form (React Hook Form + Zod resolver)
        │  typed payload
        ▼
Server Action  ── requirePermission(...)      ← throws ForbiddenError
        │      ── schema.parse(input)         ← throws ValidationError
        ▼
Service        ── domain rules (hierarchy, rollup, recurrence)
        │
        ▼
prisma.$transaction([
    mutate entity,
    write ActivityLog row,       ← audit is inside the same transaction
    recompute parent rollup,
])
        │
        ▼
revalidatePath(...)  →  ActionResult<T>
```

Auditing is written **inside the transaction**, so the timeline can never drift
from the data it describes.

## 4. Authorization

Two layers, evaluated in `features/auth/guards.ts`:

1. **Global** — `roleHas(role, permission)` against the matrix in
   `core/domain/rbac.ts`.
2. **Project scope** — `canInProject({ role, memberRole, isOwner }, permission)`.
   Admins short-circuit. Project-administrative permissions additionally require
   `MANAGER` membership or ownership. `VIEWER` members are read-only.

Route protection is layered too: middleware gates whole route groups cheaply via
JWT, and each Server Action re-checks independently — middleware is a UX
convenience, the action is the actual boundary.

## 5. Ticket hierarchy

```
Project
 └── Parent Ticket   (a feature, e.g. "Authentication Module")
      └── Child Ticket  (an implementation task, e.g. "Login API")
```

Depth is capped at two levels, enforced in `assertValidParent()`:
a ticket that has children cannot become a child, and a child cannot gain
children. Parents roll up progress from their children — completion percentage
excludes cancelled children from the denominator, and the parent's status is
advanced automatically when `ProjectSettings.autoStatusRollup` is on.

## 6. AI layer

`infrastructure/ai` exposes one `AiProvider` port with two adapters (Groq and
Ollama) selected by `AI_PROVIDER`. The Copilot never writes to the database
directly: the model emits a **typed tool call**, which is validated with Zod and
then dispatched to the very same Server Actions the UI uses. The model therefore
inherits every permission check and audit-log write automatically — it cannot
take an action a user could not take themselves.

Destructive or bulk operations are returned to the UI as a **proposal** that the
user confirms before execution.

## 7. Scalability notes

- Per-project ticket numbering is allocated inside the write transaction via an
  atomic `increment` on `ProjectSettings.nextTicketNumber`, so concurrent
  creation cannot produce duplicate keys.
- Kanban ordering uses sparse float positions, so a drag rewrites **one** row
  rather than reindexing a column.
- Dashboard aggregates use `groupBy`/`count` rather than loading ticket rows.
- Every filter, sort and lookup path in the UI is backed by an index — see the
  index list in `docs/ER-DIAGRAM.md`.
