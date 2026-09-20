# Folder Structure

```
taskforge/
├── prisma/
│   ├── schema.prisma              # 26 models, fully normalized
│   ├── migrations/                # SQL migrations (checked in)
│   ├── seed.ts                    # idempotent: roles, admin, templates
│   ├── seed-templates.ts          # the 4 built-in project templates
│   └── seed-demo.ts               # opt-in demo workspace (SEED_DEMO=true)
│
├── docs/
│   ├── ARCHITECTURE.md            # layering, mutation flow, authorization, AI design
│   ├── ER-DIAGRAM.md              # relationships, normalization notes, index coverage
│   ├── DEPLOYMENT.md              # Vercel + Neon, cron, troubleshooting
│   └── PROJECT-STRUCTURE.md       # this file
│
├── scripts/
│   └── verify-domain.ts           # 49 assertions over the pure domain (npm run verify)
│
└── src/
    ├── app/                       # routing only — no business logic
    │   ├── (auth)/login/
    │   ├── (app)/                 # authenticated shell: sidebar, topbar, palette, Copilot
    │   │   ├── dashboard/
    │   │   ├── my-tickets/
    │   │   ├── activity/
    │   │   ├── forbidden/         # access-denied explanation
    │   │   ├── error.tsx          # safety-net boundary
    │   │   ├── not-found.tsx
    │   │   ├── admin/{users,roles,teams,templates,sessions}/   # redirects → workspace/
    │   │   ├── settings/{,notifications,security,tokens}/       # your account
    │   │   ├── workspace/{people,roles,teams,templates,sessions}/ # administration
    │   │   ├── tickets/[ticketKey]/
    │   │   └── projects/
    │   │       ├── new/
    │   │       └── [projectId]/
    │   │           ├── board/      calendar/   insights/   labels/
    │   │           ├── table/      timeline/   members/    settings/
    │   │           └── tree/       recurring/  activity/
    │   ├── api/
    │   │   ├── auth/[...nextauth]/ # Auth.js handler
    │   │   └── cron/recurring/     # scheduler, guarded by CRON_SECRET
    │   ├── layout.tsx
    │   └── globals.css             # design tokens, validated chart palette
    │
    ├── core/                       # framework-free domain — imports nothing outward
    │   └── domain/
    │       ├── rbac.ts             # permission matrix + project scoping
    │       ├── ticket-rules.ts     # 2-level hierarchy, progress rollup
    │       ├── recurrence.ts       # pure date arithmetic for schedules
    │       ├── defaults.ts         # seed workflow + colour system
    │       ├── errors.ts           # typed domain error hierarchy
    │       └── result.ts           # ActionResult discriminated union
    │
    ├── infrastructure/             # adapters
    │   ├── db/prisma.ts            # client, cached on globalThis in dev
    │   ├── auth/password.ts        # bcrypt + timing-safe non-existent-user path
    │   └── ai/                     # AiProvider port + Groq and Ollama adapters
    │
    ├── features/                   # vertical slices
    │   ├── auth/                   # actions, schemas, guards, forms
    │   ├── projects/               # actions, config-actions, service, queries, context
    │   ├── tickets/                # actions, service, queries, board/table/tree/…
    │   ├── labels/                 # actions incl. cross-project import
    │   ├── comments → tickets/     # threads live with the ticket slice
    │   ├── activity/               # audit writer, queries, timeline UI
    │   ├── filters/                # filter contract, URL codec, saved sets
    │   ├── dashboard/              # analytics queries + Recharts components
    │   ├── recurring/              # schedules, generation service
    │   ├── command/                # palette search + quick actions
    │   ├── ai/                     # tools, resolver, executor, service, panel
    │   ├── settings/               # account module list (navigation as data)
    │   ├── workspace/              # administration module list + its permissions
    │   └── admin/                  # user management UI
    │
    ├── components/
    │   ├── ui/                     # shadcn/ui primitives (28)
    │   └── shared/                 # cross-feature: avatars, badges, pickers, shell
    │
    ├── lib/                        # utils, env contract, safe-action wrapper
    ├── types/                      # Auth.js module augmentation
    ├── auth.ts                     # Node-runtime Auth.js (Credentials + DB revalidation)
    ├── auth.config.ts              # edge-safe half, used by middleware
    └── middleware.ts               # route gate + forced-password-change redirect
```

## The dependency rule

Dependencies point **inward only**:

```
app  →  features  →  core
          ↓
     infrastructure  →  core
```

`core` imports nothing from `app`, `features` or `infrastructure`. That is what
makes the rules in `rbac.ts`, `ticket-rules.ts` and `recurrence.ts` directly
unit-testable with no database, no network and no framework — which is exactly
what `npm run verify` does.

## Where to add things

| Task | Where |
|---|---|
| New business rule | `core/domain/` — then assert it in `scripts/verify-domain.ts` |
| New mutation | `features/<slice>/actions.ts` — guard, validate, transact, audit |
| New read model | `features/<slice>/queries.ts` |
| New page | `app/(app)/…` — keep it thin; it should mostly compose |
| New AI capability | `features/ai/tools.ts` + a case in `executor.ts` |
| New shared widget | `components/shared/` |
