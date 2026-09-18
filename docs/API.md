# API Reference

TaskForge has **three** programmable surfaces. They share one execution core, so
a capability added once is available to all three.

```
  in-app UI          AI Copilot           MCP client
  (Server Actions)   (tool calls)         (Claude, agents)
        │                  │                   │
        └──────────────────┼───────────────────┘
                           ▼
              guard → validate → transact → audit
```

Nothing bypasses that path. A tool call and a button click take the same route.

---

## 1. Server Actions

The primary surface. There is deliberately **no REST CRUD API** — Server Actions
are typed end to end, so the client cannot construct a call the server does not
accept, and the payload contract is the TypeScript type.

### Contract

Every action returns a discriminated result. Actions never throw across the
boundary:

```ts
type ActionResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; code?: string; fieldErrors?: Record<string, string[]> }
```

```ts
const result = await createTicketAction({ projectId, title: 'Login returns 500' })

if (!result.success) {
  // result.error is safe to display; fieldErrors maps onto form fields
  return
}
result.data.key // "ATLAS-14"
```

### Error codes

| `code` | Meaning | HTTP equivalent |
|---|---|---|
| `VALIDATION_ERROR` | Zod rejected the input; see `fieldErrors` | 422 |
| `UNAUTHORIZED` | Not signed in | 401 |
| `FORBIDDEN` | Signed in, insufficient permission | 403 |
| `NOT_FOUND` | Entity missing or not visible to you | 404 |
| `CONFLICT` | Unique constraint, e.g. duplicate project code | 409 |
| `BUSINESS_RULE` | Domain rule refused it, e.g. hierarchy depth | 400 |
| `INTERNAL` | Logged server-side; message is deliberately generic | 500 |

### Surface

Every action is guarded. `requireActor` = signed in;
`requirePermission` = global role; `requireProjectPermission` = role **and**
project membership.

#### Tickets — `features/tickets/actions.ts`

| Action | Guard |
|---|---|
| `createTicketAction` | `ticket:create` in project |
| `bulkCreateTicketsAction` | `ticket:create` — one parent + children, one transaction |
| `addChildTicketsAction` | `ticket:create` — titles under an existing parent |
| `updateTicketAction` | `ticket:update`; a plain USER may only edit tickets they own or report |
| `moveTicketAction` | `ticket:transition` — Kanban drop, sparse float positioning |
| `bulkUpdateTicketsAction` | `ticket:update-any` on **every** affected project |
| `archiveTicketAction` | `ticket:update-any` — cascades to children |
| `deleteTicketAction` | `ticket:delete` — children are detached, not deleted |
| `addResourceAction` / `removeResourceAction` | `ticket:update` |
| `createCommentAction` | `comment:create` |
| `updateCommentAction` | Author only — **not** overridable by an admin |
| `deleteCommentAction` | Author, or `comment:delete-any`. Soft delete |
| `suggestSimilarTicketsAction` | `project:view` — deterministic, no AI call |

#### Projects — `features/projects/actions.ts`

| Action | Guard |
|---|---|
| `createProjectAction` | `project:create` — clones a template's workflow |
| `updateProjectAction` | `project:update` — a new owner is auto-added as manager |
| `archiveProjectAction` | `project:archive` |
| `updateProjectSettingsAction` | `project:manage-config` |
| `addMembersAction` · `updateMemberRoleAction` · `removeMemberAction` | `project:manage-members` |
| `searchAssignableUsers` | Signed in |

#### Workflow config — `features/projects/config-actions.ts`

`upsertStatusAction` · `reorderStatusesAction` · `deleteStatusAction` ·
`upsertPriorityAction` · `deletePriorityAction` · `upsertTicketTypeAction` ·
`deleteTicketTypeAction` — all `project:manage-config`.

> Deletion **requires a replacement**. Tickets hold a required FK to status,
> priority and type, so `onDelete: Restrict` makes orphaning impossible by
> construction; supplying where the tickets should move is the supported path.

#### Labels · Recurring · Filters · Admin · AI

| Action | Guard |
|---|---|
| `createLabelAction` · `updateLabelAction` · `deleteLabelAction` | `label:*` |
| `importLabelsAction` | `label:create` on target **and** read access to source |
| `upsertRecurringAction` · `toggleRecurringAction` · `deleteRecurringAction` | `recurring:manage` |
| `saveFilterAction` · `deleteFilterAction` · `listSavedFilters` | Signed in; owner-scoped |
| `createUserAction` · `updateUserAction` · `setUserActiveAction` · `adminResetPasswordAction` | **Admin** |
| `changePasswordAction` · `updateProfileAction` | Self |
| `copilotAction` | `ai:use` |

---

## 2. Route Handlers

Only where a Server Action cannot be used.

### `GET|POST /api/auth/[...nextauth]`

Auth.js. Credentials provider, JWT sessions (required for credentials).
Sessions are revoked server-side by incrementing `User.sessionVersion`;
deactivating a user or resetting their password does this automatically, and a
live token is re-checked against the database at most every 5 minutes.

### `GET /api/cron/recurring`

Materialises due recurring tickets.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/recurring
```

`?key=` is accepted for schedulers that cannot set headers. The secret is
compared in constant time.

```json
{ "ok": true, "generated": 1, "tickets": ["PAY-17"],
  "deactivated": 0, "errors": [], "durationMs": 13 }
```

| Status | Meaning |
|---|---|
| `200` | Sweep ran. `errors[]` is per-schedule — one failure does not abort the rest |
| `401` | Missing or wrong secret |
| `503` | `CRON_SECRET` not configured |

Safe to call more often than scheduled, and safe to miss: a schedule that missed
several runs generates **one** ticket and catches up, rather than flooding the
board.

---

## 3. AI tool contracts

The Copilot's tools are the same surface, described for a model. The Zod schema
generates the JSON Schema sent to the provider, so the model-facing contract and
the server-side trust boundary cannot drift.

| Tool | Effect |
|---|---|
| `find_duplicates` | Read — Jaccard title overlap, no AI call |
| `search_tickets` | Read — the shared filter engine |
| `project_insights` | Read — description, dates, team, labels, health |
| `create_ticket` | **Write** |
| `bulk_create_tickets` | **Write** — parent + children, one transaction |
| `update_ticket` | **Write** — status, assignee, priority, due date, labels |

**There is no delete tool.** "Remove everything" is not a request the model can
carry out — by construction, not by prompt.

Bounds are deliberately absent from the model-facing schema. Providers validate
it server-side and reject the entire request, so a model emitting `limit: 0`
would break the turn; values are clamped instead.

See [`ARCHITECTURE.md`](ARCHITECTURE.md#6-ai-layer) for the dispatch design and
its known gap (writes execute without a confirmation step).

---

## 4. MCP server

TaskForge ships an MCP server exposing the same tools to any MCP client.
See [`MCP.md`](MCP.md).

---

## Authorization model

Two layers, evaluated in `features/auth/guards.ts`:

1. **Global** — `roleHas(role, permission)` against the typed matrix in
   `core/domain/rbac.ts`.
2. **Project scope** — `canInProject({ role, memberRole, isOwner }, permission)`.
   Admins short-circuit. Project-administrative permissions additionally require
   `MANAGER` membership or ownership. `VIEWER` members are read-only.

Role *assignment* is relational; role *policy* is compile-time-checked
TypeScript. One source of truth, no database round-trip to authorize.

Middleware gates routes on the JWT for speed, but it is **not** the boundary —
every action re-checks independently. Bypassing the UI gains you nothing.
