# API reference

Everything TaskForge exposes to code: the REST API, outbound webhooks, the other
route handlers, and the Server Actions the UI calls. Every entry here was written
from the handler or action it describes; where the code and a comment disagree,
this document follows the code and says so.

## Contents

1. [Surfaces at a glance](#1-surfaces-at-a-glance)
2. [REST API v1](#2-rest-api-v1)
   - [Authentication](#authentication)
   - [Response envelope and status codes](#response-envelope-and-status-codes)
   - [GET /api/v1/projects](#get-apiv1projects)
   - [GET /api/v1/tickets](#get-apiv1tickets)
   - [POST /api/v1/tickets](#post-apiv1tickets)
   - [GET /api/v1/tickets/{key}](#get-apiv1ticketskey)
   - [PATCH /api/v1/tickets/{key}](#patch-apiv1ticketskey)
   - [POST /api/v1/tickets/{key}/comments](#post-apiv1ticketskeycomments)
   - [Limits and quirks](#limits-and-quirks)
3. [Outbound webhooks](#3-outbound-webhooks)
4. [Other route handlers](#4-other-route-handlers)
5. [Server Actions](#5-server-actions)
6. [ActionResult and error codes](#6-actionresult-and-error-codes)
7. [Permission catalogue](#7-permission-catalogue)

---

## 1. Surfaces at a glance

| Surface | Path | Caller | Authenticated by | Source |
|---|---|---|---|---|
| Server Actions | page POSTs | The app's own UI | Session cookie (Auth.js JWT) | `src/features/*/actions.ts` |
| REST API v1 | `/api/v1/*` | Scripts, CI, other systems | Personal access token | `src/app/api/v1`, `src/features/public-api/handler.ts` |
| MCP bridge | `/api/mcp` | MCP clients (via `npm run mcp`) | Personal access token | `src/app/api/mcp/route.ts`, [MCP.md](MCP.md) |
| Outbound webhooks | your URL | TaskForge calls you | HMAC-SHA256 signature | `src/features/webhooks-out/service.ts` |
| Inbound integrations | `/api/github/webhook`, `/api/msteams/messages`, `/api/ingest/errors/*` | GitHub, Microsoft, Sentry | Signature, Bot Framework JWT, path secret | see [section 4](#4-other-route-handlers) |
| Crons | `/api/cron/*` | Vercel Cron, GitHub Actions | `CRON_SECRET` | `src/app/api/cron` |

The REST API and the MCP bridge are the same thing in two shapes. Both hand a
request to `executeTool` in `src/features/ai/executor.ts` — the Copilot's tool
dispatcher — which validates the arguments with the tool's Zod schema and then
calls the same Server Action a click would (`createTicketAction`,
`updateTicketAction`, `createCommentAction`). There is no API-only write path.

---

## 2. REST API v1

### Authentication

Send a personal access token as a bearer token:

```
Authorization: Bearer tf_3q9V…
```

| Property | Behaviour |
|---|---|
| Creating one | *Settings → Access tokens* (`createTokenAction`). Any signed-in person may create tokens for themselves. |
| Format | `tf_` followed by 32 random bytes, base64url. The first 11 characters are kept as a display prefix. |
| Storage | Only the SHA-256 of the token is stored. The plaintext is shown once and cannot be recovered. |
| Expiry | Optional, 1 to 365 days. No expiry if not set. |
| Authority | A token is an alias for its owner. It carries no permissions of its own; it resolves to the same `Actor` a browser session does, with the owner's role read fresh on each request. |
| Invalidation | Revoking it, its expiry passing, or its owner being deactivated. All three answer the same 401, so the API cannot be used to tell a revoked token from one that never existed. |
| Revoking | `revokeTokenAction` — your own tokens, or anyone's with `user:update`. |

Middleware lets `/api/v1/*` through without a session; the handler
(`withActor`) authenticates the token itself.

### Response envelope and status codes

Successful calls and tool-level failures share one envelope:

```json
{ "ok": true, "message": "Human-readable summary", "data": { "kind": "…" } }
```

`message` is the tool's summary — the text written for a model, which often
carries more detail than `data`. `data` is present only when the tool produced
structured output.

There are two failure shapes, depending on where the refusal happened:

| Where it failed | Body | Status |
|---|---|---|
| No or invalid token | `{ "error": "Unauthorized. Send Authorization: Bearer <personal access token>." }` | 401 |
| Body is not a JSON object | `{ "ok": false, "error": "The body must be a JSON object." }` | 400 |
| `project` names nothing you can see | `{ "ok": false, "error": "No project DEMO that you can see." }` | 404 |
| A domain error thrown outside a Server Action (ticket key not found or not visible, "which project?", view permission) | `{ "ok": false, "error": "…", "code": "NOT_FOUND" }` | the error's own status (400, 401, 403, 404, 409, 422) |
| The tool or the Server Action refused (validation, permission, business rule) | `{ "ok": false, "message": "…" }` | 404 if the message reads like "not found", otherwise 422 |
| Anything else | `{ "ok": false, "error": "The request failed unexpectedly." }` | 500 |

A permission refusal from inside a Server Action — for example a token whose
owner lacks `ticket:create` in the project — arrives as **422 with a
`message`**, not 403, because the action returns an `ActionResult` rather than
throwing. Check `ok`, not only the status.

Successful creates (`POST /tickets`, `POST /comments`) answer **201**; everything
else answers **200**.

### GET /api/v1/projects

The non-archived projects the token's owner can see, ordered by name.

```bash
curl -s https://taskforge.example.com/api/v1/projects \
  -H "Authorization: Bearer $TASKFORGE_TOKEN"
```

```json
{
  "ok": true,
  "data": [
    {
      "code": "DEMO",
      "name": "Demo project",
      "status": "ACTIVE",
      "description": "The seeded example.",
      "startDate": "2026-09-01T00:00:00.000Z",
      "endDate": null
    }
  ]
}
```

Visibility is `projectVisibilityFilter`: projects you own, are a member of, or
reach through a team — or every project with `project:view-all`.

| Status | When |
|---|---|
| 200 | Always, for a valid token |
| 401 | No or invalid token |

### GET /api/v1/tickets

Search tickets. Backed by the `search_tickets` tool.

| Query parameter | Type | Notes |
|---|---|---|
| `project` | project code | Scopes the search. Unknown or invisible code → 404. Without it, every project you can see is searched. |
| `q` | text | Full-text search over title, description and remarks, with a trigram fallback on the key. |
| `category` | `BACKLOG` `TODO` `IN_PROGRESS` `BLOCKED` `REVIEW` `DONE` `CANCELLED` | Case-insensitive. Works with or without `project`. |
| `status` | status name | Matched case-insensitively, then by prefix, then by substring. **Needs `project`.** |
| `priority` | priority name | As `status`. **Needs `project`.** |
| `type` | ticket type name | As `status`. **Needs `project`.** |
| `label` | label name | As `status`. **Needs `project`.** |
| `assignee` | `me`, username or name | `me` works everywhere; a name or username needs `project` and matches only direct project members. |
| `overdue` | `1` | Overdue tickets only. |
| `unassigned` | `1` | Unassigned tickets only. |
| `limit` | integer | Clamped to 1–50. Default 15. |

Names that do not resolve are ignored rather than rejected, and without
`project` the name filters are ignored entirely — the executor only resolves
names inside a project. Results are sorted by priority, highest first.

```bash
curl -s "https://taskforge.example.com/api/v1/tickets?project=DEMO&category=IN_PROGRESS&assignee=me&limit=2" \
  -H "Authorization: Bearer $TASKFORGE_TOKEN"
```

```json
{
  "ok": true,
  "message": "Found 7 matching tickets (showing 2):\nDEMO-12 — Checkout button unresponsive [In Progress, High, Asha Rao]\nDEMO-9 — Contact email link [In Progress, Medium, Asha Rao]",
  "data": {
    "kind": "search",
    "total": 7,
    "tickets": [
      {
        "id": "cm1…",
        "key": "DEMO-12",
        "title": "Checkout button unresponsive",
        "status": "In Progress",
        "statusColor": "#3b82f6",
        "priority": "High",
        "priorityColor": "#f97316",
        "priorityLevel": 3,
        "assignee": "Asha Rao",
        "assigneeColor": "#0ea5e9",
        "dueDate": "2026-10-02T17:00:00.000Z",
        "projectCode": "DEMO"
      }
    ]
  }
}
```

No match is still `ok: true`, with `"message": "No tickets matched those filters."`
and `"data": { "kind": "search", "tickets": [], "total": 0 }`.

| Status | When |
|---|---|
| 200 | Search ran |
| 401 | No or invalid token |
| 404 | `project` is not a code you can see |
| 422 | Arguments failed validation (for example a `category` outside the list) |

### POST /api/v1/tickets

Create one ticket. Backed by the `create_ticket` tool, which calls
`createTicketAction`.

| Body field | Type | Required | Notes |
|---|---|---|---|
| `project` | project code | yes | Without it the call answers 400 `BUSINESS_RULE`: "Which project?" |
| `title` | string, 3–200 | yes | |
| `description` | string, ≤ 5000 | no | Markdown. |
| `type` | type name | no | Unresolved → project default, with a warning. |
| `priority` | priority name | no | Unresolved → project default, with a warning. |
| `status` | status name | no | Unresolved → the project's initial status. |
| `assignee` | username or name | no | Direct project members only. Unresolved → unassigned, with a warning. |
| `labels` | string[] | no | Names; unknown names are dropped silently. |
| `dueInDays` | integer | no | Clamped to 0–3650; due at 17:00 server time on that day. |
| `parentKey` | ticket key | no | Two-level hierarchy only. |
| `acceptanceCriteria` | string[], ≤ 12 of ≤ 300 | no | Otherwise the ticket type's template criteria are used. |

Unknown fields are stripped by the schema. The action applies everything a
ticket created in the UI gets: an atomically allocated key, the project's
due-date and subtask rules, custom-field requirements, the audit entry,
assignment notification, the urgent-ticket alert, the Teams announcement and the
triage agent.

```bash
curl -s -X POST https://taskforge.example.com/api/v1/tickets \
  -H "Authorization: Bearer $TASKFORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "DEMO",
    "title": "Checkout button unresponsive on Safari",
    "type": "Bug",
    "priority": "High",
    "assignee": "asha",
    "labels": ["frontend"],
    "dueInDays": 3,
    "acceptanceCriteria": ["Button submits on Safari 17", "Regression test added"]
  }'
```

```json
{
  "ok": true,
  "message": "Created DEMO-41 — \"Checkout button unresponsive on Safari\" in Demo project, assigned to Asha Rao.",
  "data": {
    "kind": "ticket_created",
    "key": "DEMO-41",
    "id": "cm1…",
    "title": "Checkout button unresponsive on Safari",
    "projectName": "Demo project",
    "assignee": "Asha Rao",
    "warnings": []
  }
}
```

| Status | When |
|---|---|
| 201 | Created (check `data.warnings` for anything that did not resolve) |
| 400 | Body not a JSON object, or no `project` |
| 401 | No or invalid token |
| 404 | `project` or `parentKey` not found or not visible |
| 422 | Validation failed, project archived, no `ticket:create` in the project, due date required, subtasks disabled, a required custom field missing |

### GET /api/v1/tickets/{key}

One ticket in full. Backed by `get_ticket`, which also runs `requireProjectView`.

```bash
curl -s https://taskforge.example.com/api/v1/tickets/DEMO-12 \
  -H "Authorization: Bearer $TASKFORGE_TOKEN"
```

```json
{
  "ok": true,
  "message": "DEMO-12 — Checkout button unresponsive\nDemo project (DEMO) · Bug · High · In Progress\nAssignee: Asha Rao (@asha)\nReporter: Sam Lee\nDue 2026-10-02\nLabels: frontend\nAcceptance criteria (1/2 met):\n  [x] Button submits on Safari 17\n  [ ] Regression test added\nPull requests: none linked.\nDeployments: none recorded — …\n\nDescription:\n…\n\nRecent comments (newest first):\n  @sam on 2026-09-28: …",
  "data": { "kind": "ticket", "key": "DEMO-12", "title": "Checkout button unresponsive" }
}
```

**The detail is in `message`, as text.** `data` carries only the key and title.
The text includes type, priority, status, assignee, reporter, due date, points,
labels, parent and children, acceptance criteria, up to five pull requests with
their CI state, up to five deployments, description, remarks and the ten most
recent comments (each cut to 300 characters).

| Status | When |
|---|---|
| 200 | Found |
| 401 | No or invalid token |
| 403 | The project is private, or you are not a member and lack `project:view-all` |
| 404 | No ticket with that key in a project you can see |

### PATCH /api/v1/tickets/{key}

Change a ticket. Backed by `update_ticket`, which calls `updateTicketAction`.

| Body field | Type | Notes |
|---|---|---|
| `status` | status name | Unknown → 422 listing the project's statuses. Entering a status with requirements (assignee, estimate, criteria met, pull request, merged pull request, a custom field) is refused with what is missing. |
| `priority` | priority name | Unknown names are ignored. |
| `assignee` | username, name, or `none` | Direct project members only. No match → 422. |
| `dueInDays` | integer | Clamped to 0–3650. |
| `addLabels` | string[] | Adds the named labels; existing labels stay. |
| `title` | string, 3–200 | |

```bash
curl -s -X PATCH https://taskforge.example.com/api/v1/tickets/DEMO-12 \
  -H "Authorization: Bearer $TASKFORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "Review", "assignee": "sam" }'
```

```json
{
  "ok": true,
  "message": "Updated DEMO-12: status → Review, assigned to Sam Lee.",
  "data": {
    "kind": "ticket_updated",
    "key": "DEMO-12",
    "title": "Checkout button unresponsive",
    "changes": ["status → Review", "assigned to Sam Lee"]
  }
}
```

The permission is `ticket:update` in the ticket's project (a status change
through this path does not additionally check `ticket:transition`). Without
`ticket:update-any`, and unless you manage or own the project, you may only edit
tickets assigned to you or reported by you.

| Status | When |
|---|---|
| 200 | Updated |
| 400 | Body not a JSON object |
| 401 | No or invalid token |
| 404 | No ticket with that key in a project you can see |
| 422 | Unknown status, unmatched assignee, unmet status requirements, validation, or a permission refusal |

### POST /api/v1/tickets/{key}/comments

Post a comment. Backed by `comment_on_ticket`, which calls `createCommentAction`,
so `@username` mentions are resolved and notified in the same transaction as the
comment and its audit entry.

| Body field | Type | Notes |
|---|---|---|
| `body` | string, 1–5000 | Markdown. Required. |

```bash
curl -s -X POST https://taskforge.example.com/api/v1/tickets/DEMO-12/comments \
  -H "Authorization: Bearer $TASKFORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Reproduced on Safari 17.4. @asha the handler is detached on re-render." }'
```

```json
{ "ok": true, "message": "Commented on DEMO-12.", "data": { "kind": "comment", "ticketKey": "DEMO-12" } }
```

| Status | When |
|---|---|
| 201 | Posted |
| 400 | Body not a JSON object, or `body` not a string |
| 401 | No or invalid token |
| 404 | No ticket with that key in a project you can see |
| 422 | Validation, or no `comment:create` in the project |

### Limits and quirks

| Quirk | Detail |
|---|---|
| No rate limit | The API has no request limit of its own. |
| No pagination | Search returns at most 50 rows with the full `total`. |
| Writes are immediate | Unlike the Copilot, the API and MCP bridge do not propose-then-confirm; the call is the approval. |
| Assignees are project people | `resolveUser` matches direct members and anyone a team attached to the project brings in; agent accounts are never matched. |
| Name matching is forgiving | Status, priority, type and label names match exactly, then by prefix, then by substring, case-insensitively. "Rev" finds "Review". |
| No delete | There is no delete endpoint, by design, as there is no delete tool. |

---

## 3. Outbound webhooks

Configured in *Workspace → Integrations* by anyone with `integration:manage`
(`createWebhookAction`). Each webhook has a name, a URL, one or more events, and
optionally a single project; without one it hears every project.

### Events

| Event | Fires when | Source row |
|---|---|---|
| `ticket.created` | A ticket is inserted | First `ticket_status_changes` row for the ticket (`fromCategory` is null) |
| `ticket.status_changed` | A ticket's `statusId` changes | Any later `ticket_status_changes` row |
| `ticket.completed` | A status change lands in the `DONE` category | Same row; sent in addition to `ticket.status_changed` |
| `comment.created` | A comment is posted and not deleted before the sweep | `comments` |
| `ping` | *Test* is pressed (`testWebhookAction`) | none — delivered synchronously |

Events are read from the histories the database already keeps, not emitted by
each write path. The five-minute cron (`sweepOutbox`) reads rows newer than a
cursor (at most 500 of each kind per sweep, the rest next time) and queues one
`webhook.deliver` job per event per matching webhook. Latency is therefore up to
five minutes plus queue time. When no webhook is active, the cursor is moved to
now, so a first webhook does not replay history.

### Payloads

Every body has the same outer shape:

```json
{ "event": "ticket.status_changed", "deliveredAt": "2026-09-29T10:05:12.345Z", "data": { } }
```

`data` by event, exactly as `sweepOutbox` builds it:

```jsonc
// ticket.created
{
  "ticket": { "key": "DEMO-41", "title": "…", "project": "DEMO", "url": "https://…/tickets/DEMO-41" },
  "status": "To Do"
}

// ticket.status_changed
{
  "ticket": { "key": "DEMO-41", "title": "…", "project": "DEMO", "url": "https://…/tickets/DEMO-41" },
  "from": "TODO",
  "to": "IN_PROGRESS",
  "changedAt": "2026-09-29T10:01:44.000Z"
}

// ticket.completed
{
  "ticket": { "key": "DEMO-41", "title": "…", "project": "DEMO", "url": "https://…/tickets/DEMO-41" },
  "completedAt": "2026-09-29T10:01:44.000Z"
}

// comment.created
{
  "ticket": { "key": "DEMO-41", "title": "…", "url": "https://…/tickets/DEMO-41" },
  "author": { "name": "Asha Rao", "username": "asha" },
  "body": "Markdown, cut to 5000 characters",
  "createdAt": "2026-09-29T10:03:02.000Z"
}

// ping
{ "message": "A test delivery from TaskForge." }
```

Points to note:

- `from` and `to` are status **categories**, not status names.
- `ticket.created`'s `status` is the ticket's status name **at sweep time**,
  which may already differ from the one it was created in.
- `comment.created`'s `ticket` has no `project` field.
- A ticket created directly in a Done status produces only `ticket.created`;
  `ticket.completed` follows a *change* into `DONE`.
- The URL base is the app's configured public URL (`appUrl()`).

### Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `TaskForge-Webhooks/1.0` |
| `X-TaskForge-Event` | the event name |
| `X-TaskForge-Signature` | `sha256=` + hex HMAC-SHA256 of the raw body |

### Signature verification

The secret (`whsec_…`) is shown once when the webhook is created; TaskForge keeps
only a sealed copy. The HMAC key is the **whole secret string, prefix included**.
Compute over the raw bytes you received, before any JSON parsing, and compare in
constant time.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyTaskForge(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

```python
import hmac, hashlib

def verify_taskforge(raw_body: bytes, header: str | None, secret: str) -> bool:
    if not header:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header, expected)
```

There is no timestamp header or delivery id. `deliveredAt` sits inside the signed
body, so a receiver that wants replay protection can reject old deliveries by it.

### Delivery and retries

| Behaviour | Detail |
|---|---|
| Timeout | 10 seconds |
| Redirects | Not followed (`redirect: 'manual'`); a 3xx counts as a failure |
| Success | Any 2xx |
| Retries | Up to 6 attempts on the job queue, backing off 1 min, 5 min, 30 min, 2 h, 6 h |
| De-duplication | One job per webhook, event and source row (`wh:<hook>:<event>:<row>`), so a re-run sweep does not double-send |
| Address check | The URL must be http(s) with no credentials, not `localhost`, `.local`, `.internal` or a private IP; at delivery time every address the host resolves to is checked again, so a public name later pointed at `127.0.0.1` is refused |
| Status | The webhook row records `lastStatus`, `lastError` and `lastDeliveredAt`, shown on the integrations page |
| Failed jobs | Stay `FAILED` until *Retry* (`retryJobsAction`); deleting a webhook deletes its pending and failed deliveries |

Order is not guaranteed across events.

---

## 4. Other route handlers

Middleware (`src/middleware.ts`) runs first on every path except static assets
and the icon routes. It lets these through without a session, because they
authenticate themselves: `/api/auth/*`, `/api/cron/*`, `/api/mcp`, `/api/v1/*`,
`/api/github/webhook`, `/api/msteams/messages`, `/api/ingest/*`. **Every other
`/api/*` path needs a session cookie** — a signed-out request gets a JSON 401
before the handler runs, even when the handler itself would accept a bearer
token.

| Route | Method | Caller | Authenticated by | Permission |
|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | Browser | Auth.js | public |
| `/api/mcp` | GET, POST | MCP clients | Bearer token (or session) | the owner's |
| `/api/cron/recurring` | GET | Vercel Cron, daily 06:00 UTC | `CRON_SECRET` as bearer or `?key=` | none |
| `/api/cron/monitors` | GET | GitHub Actions, every 5 min | `CRON_SECRET` as bearer only | none |
| `/api/github/webhook` | POST | GitHub | `X-Hub-Signature-256` | none |
| `/api/github/manifest` | GET | Browser | Session | `integration:manage` |
| `/api/github/manifest/callback` | GET | GitHub redirect | Session + `state` cookie | `integration:manage` |
| `/api/github/setup` | GET | GitHub redirect | Session | `integration:manage` |
| `/api/github/user/authorize` | GET | Browser | Session | signed in |
| `/api/github/user/callback` | GET | GitHub redirect | Session + `state` cookie | signed in |
| `/api/msteams/messages` | POST | Bot Connector | Bot Framework JWT | none (acts as the matched person) |
| `/api/msteams/app-package` | GET | Browser | Session | `integration:manage` |
| `/api/ingest/errors/{token}` | POST | Sentry or any app | Secret in the path | none |
| `/api/attachments/{id}` | GET | Browser | Session | view the ticket's project |
| `/api/avatars/{userId}` | GET | Browser | Session | signed in |
| `/api/live` | GET | Board and table | Session | `requireProjectView` |
| `/api/export/tickets` | GET | Browser | Session | signed in; rows limited to visible tickets |
| `/api/ai/transcribe` | POST | Browser | Session | `ai:use` |
| `/pwa-icon/{size}` | GET | Browser, OS | none | public |

### /api/mcp

The MCP bridge. `GET` returns the catalogue: the actor (`username`, `name`,
`role`), up to 50 visible projects, and every tool with its JSON Schema. `POST`
calls one tool:

```json
{ "tool": "search_tickets", "arguments": { "statusCategory": "BLOCKED" }, "projectCode": "DEMO" }
```

The response is the executor's `ToolResult` (`ok`, `summary`, optional `reply`,
`data`) with 200 or 422; an unknown tool is 404 with the list of available ones;
a domain error returns its own status with `{ ok: false, summary, code }`. The
MCP bridge exposes every tool, including `bulk_create_tickets`,
`find_duplicates`, `project_insights` and `search_memory`, which the REST API
does not. An unknown `projectCode` is ignored here, where the REST API answers
404. See [MCP.md](MCP.md) for the stdio server that wraps it.

### Crons

Both compare the secret in constant time and answer 503 if `CRON_SECRET` is not
set, 401 if it does not match. Every sub-task catches its own failure, so one
broken step never hides the others' results.

| Route | Does | Returns (JSON) |
|---|---|---|
| `/api/cron/recurring` (daily) | Generates due recurring tickets; embeds up to 300 stale ticket embeddings; reconciles every linked GitHub repository (if GitHub is connected); sends daily digests; queues `memory.index` for projects with memory on; on Mondays also refreshes model prices, sends the weekly AI usage report and manager digests, and queues `handbook.generate` where auto-refresh is on; then drains up to 10 jobs within 60 s. `maxDuration` 120 s. | `ok`, `generated`, `tickets`, `deactivated`, `errors`, `embedded`, `embeddingsRemaining`, `github`, `dailyDigest`, `usageReport`, `managerDigest`, `prices`, `jobs`, `durationMs`; 500 `{ ok: false }` if ticket generation itself throws |
| `/api/cron/monitors` (5 min) | Runs due uptime monitors, sweeps SLA alerts and polls the inbound mailbox in parallel; then sweeps the webhook outbox and drains up to 20 jobs within 30 s. `maxDuration` 60 s. | `ok`, the monitor result, `sla`, `email`, `outbox`, `jobs`, `durationMs` |

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://taskforge.example.com/api/cron/monitors
```

### GitHub

| Route | Detail |
|---|---|
| `POST /api/github/webhook` | 503 if no GitHub App is configured. The raw body is verified against `X-Hub-Signature-256` with the app's webhook secret before it is parsed; a bad signature is 401. Handled events (`ping`, `installation`, `installation_repositories`, `repository`, `create`, `delete`, `push`, `pull_request`, `deployment_status`, `check_suite`) answer 200 with `{ ok, event, delivery, handled, tickets, … }`; others 202; a failure 500, so GitHub shows it red and can redeliver. Affected ticket pages are revalidated. |
| `GET /api/github/manifest?org=` | Answers a self-submitting HTML form that posts the app manifest to GitHub (personal account, or the named organisation), and sets an httpOnly `gh_manifest_state` cookie (15 min, path `/api/github`). 403 JSON without `integration:manage`; 400 for an invalid organisation name. |
| `GET /api/github/manifest/callback?code=&state=` | Refuses a missing code or a `state` that does not match the cookie. Exchanges the code for the app's id, private key and webhook secret, stores them sealed, audits, and redirects to GitHub's install page. Failures redirect to `/workspace/integrations?error=…`. |
| `GET /api/github/setup?installation_id=&setup_action=` | GitHub's post-install redirect. The installation id is untrusted and is only used to ask GitHub, as the app, for that installation. Syncs its repositories, audits, redirects with `installed=` or `error=`. |
| `GET /api/github/user/authorize` | Redirects a signed-in person to GitHub to connect their own account, with a `gh_user_state` cookie (10 min). Signed-out → `/login`. |
| `GET /api/github/user/callback?code=&state=` | Checks `state`, exchanges the code for that person's GitHub token, audits, redirects to `/settings/github?connected=…` or `?error=…`. |

### Microsoft Teams

| Route | Detail |
|---|---|
| `POST /api/msteams/messages` | 400 if the body is not an activity (needs `serviceUrl`, `conversation.id`, `from.id`); 403 if `serviceUrl` is not a Microsoft Bot Connector host; 401 `Unauthorized: <reason>` if the Bot Framework JWT fails (RS256 only, known key id, signature, channel endorsement, audience = our app id, Bot Framework issuer, five minutes of skew, `serviceUrl` claim matching the activity). On success it answers `{}` immediately and handles the activity in `after()`, replying through the Bot Connector. Commands run as the matched TaskForge person via `actAs`. |
| `GET /api/msteams/app-package` | A zip of the Teams app manifest and icons for this bot, for upload in Teams. 403 without `integration:manage`; 400 if the bot is not connected. |

### Error intake

`POST /api/ingest/errors/{token}` — the token (`tfe_…`, stored hashed, one per
project, rotated with `rotateErrorIngestAction`) is the only credential. Unknown
and malformed tokens both answer 404.

| Body | Handling |
|---|---|
| Sentry webhook (`{ data: { event \| error } }`, or legacy `{ event, … }`) | Title, level, environment, release, stack (25 frames), top in-app frame, URL and fingerprint are taken from the event. |
| Sentry installation ping (`{ action: "installation" }`) | 200 `{ ok: true }` |
| Generic JSON | Needs at least `message` (or `title` or `error`); optional `title`, `level`, `environment`, `release` or `commit`, `stack`, `url`, `fingerprint`. |

Bodies over 256,000 characters are 413; non-JSON is 400; an unrecognised shape
is 422. Accepted events answer 202 with `{ ok, ticketKey, created, count }`, plus
`regression: true` when a finished ticket was reopened, or `throttled` when a new
ticket was held back.

### Files

| Route | Detail |
|---|---|
| `GET /api/attachments/{id}` | 401 signed out. The file is exactly as visible as its ticket's project (owner, member via direct or team membership, `project:view-all` or `project:access-all`); otherwise **404**, not 403. Unrecognised or dangerous types (SVG included) are served as `application/octet-stream` with `Content-Disposition: attachment`; headers include `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=0, must-revalidate` and `Content-Security-Policy: default-src 'none'; sandbox`. |
| `GET /api/avatars/{userId}` | Any signed-in person. The stored bytes are re-sniffed and served only as a recognised image type; `Cache-Control: private, max-age=31536000, immutable` (the page adds `?v=<avatarUpdatedAt>`), `Content-Security-Policy: default-src 'none'`. |

### Live, export and dictation

| Route | Detail |
|---|---|
| `GET /api/live?project=<id>` | 400 without `project`; 403 if you cannot view it. Returns `{ enabled: false }` when the project's live updates are off, otherwise `{ enabled: true, version: "<ticket count>:<latest ticket updatedAt ms>:<latest comment createdAt ms>" }` with `Cache-Control: no-store`. |
| `GET /api/export/tickets` | Takes the table's own query string (`project`, `assignee`, `reporter`, `status`, `category`, `priority`, `type`, `label`, `cycle`, `parent`, `q`, `dueFrom`, `dueTo`, `createdFrom`, `createdTo`, `overdue`, …) plus `format=csv\|xlsx` (default csv), `columns=` (comma list) and `name=`. At most 5,000 rows; when cut, the response carries `X-Export-Truncated: <rows> of <total>`. CSV cells are formula-escaped; XLSX cells are typed, dates as dates. |
| `POST /api/ai/transcribe` | Multipart with an `audio` file, at most 8 MB. Sent to Groq Whisper (`whisper-large-v3-turbo`). Returns `{ text }`. 503 unless `AI_PROVIDER=groq` with a key; 413 too large; 429 when Groq rate-limits; 502 on upstream failure. |

### Icons

`GET /pwa-icon/{192|512|maskable-512}` — PNG app icons drawn in code
(`src/lib/png.ts`), cached for a day. Excluded from middleware so an installing
browser is never redirected to sign-in.

---

## 5. Server Actions

The files under `src/features` that begin with `'use server'`. Every exported
async function is a Server Action the app's pages call.

Conventions:

- **Guard, validate, transact, audit, revalidate.** The guard is one of
  `requireActor` (signed in), `requirePermission(p)` (global capability) or
  `requireProjectPermission(projectId, p)` (capability plus project scope — see
  [ARCHITECTURE.md](ARCHITECTURE.md#authorization)), and `requireProjectView`
  for reads.
- "Project: `p`" below means `requireProjectPermission` on the entity's project.
  For the permissions in the manager-scoped set (`project:update`,
  `project:archive`, `project:manage-members`, `project:manage-config`,
  `label:*`, `recurring:manage`) that additionally means being the project's
  owner or a `MANAGER` in it, unless the role holds `project:access-all`.
- "Seniority" means the target person or role must rank strictly below the actor.
- A few exports (`listAttachments`, `listSavedFilters`, `searchAssignableUsers`,
  `fetchNotificationsAction`, `listSessionsAction`, `listTokensAction`) are reads
  that return data directly rather than an `ActionResult`, and throw on refusal.
- The session-or-token fallback in `getCurrentUser` means an action called
  in-process on behalf of a token (the REST API, MCP) sees the token's owner.
  Posting to a Server Action endpoint directly with only a bearer token does not
  get that far: middleware redirects a request with no session to `/login`.

### Tickets — `tickets/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `createTicketAction` | Create a ticket: allocate its key, apply project rules and type template, labels, criteria, custom fields, notify the assignee, audit; afterwards alert managers of urgent work, announce in Teams, queue triage | Project: `ticket:create` |
| `bulkCreateTicketsAction` | A parent and its children in one transaction (the breakdown dialog, the Copilot) | Project: `ticket:create` |
| `addChildTicketsAction` | Add children to an existing parent from a list of titles; refuses a grandchild | Project: `ticket:create` |
| `updateTicketAction` | Edit fields, status, assignee, parent, cycle, labels; optimistic concurrency via `expectedUpdatedAt`; status requirements enforced; parent rollup | Project: `ticket:update`; own or reported tickets only unless `ticket:update-any`, project manager or owner |
| `moveTicketAction` | Kanban drag: status and position, one row rewritten | Project: `ticket:transition` |
| `bulkUpdateTicketsAction` | Change many tickets at once; all or nothing; records a bulk operation for undo | Project: `ticket:update-any` in every affected project |
| `undoBulkUpdateAction` | Revert a bulk edit, except tickets changed since | Project: `ticket:update-any` in every affected project |
| `archiveTicketAction` | Archive or restore a ticket; archiving a parent archives its children | Project: `ticket:update-any` |
| `deleteTicketAction` | Delete a ticket | Project: `ticket:delete` |
| `addResourceAction` / `removeResourceAction` | Add or remove a resource link | Project: `ticket:update` |
| `createCommentAction` | Comment; resolves and notifies @mentions; stops the first-response clock (trigger) | Project: `comment:create` |
| `updateCommentAction` | Edit a comment | Signed in; author only |
| `deleteCommentAction` | Delete a comment | Project: `comment:create` for your own, `comment:delete-any` for others' |
| `suggestSimilarTicketsAction` | Duplicate suggestions while drafting; no AI call | Project: `project:view` |
| `linkTicketsAction` / `unlinkTicketsAction` | Relate two tickets: `BLOCKS`, `RELATES_TO`, `DUPLICATES` | Project: `ticket:update` on the source; view on the target |
| `toggleWatchAction` | Follow or unfollow a ticket | Project view |
| `suggestTriageAction` | Suggest type, priority and labels from project history; no AI call | Project view |

### Acceptance criteria — `tickets/checklist-actions.ts`

| Action | Does | Permission |
|---|---|---|
| `addCriteriaAction` | Add criteria (one per line when pasted) | Project: `ticket:update` |
| `toggleCriterionAction` | Tick or untick; audited | Project: `ticket:update` |
| `editCriterionAction` | Reword a criterion | Project: `ticket:update` |
| `removeCriterionAction` | Remove a criterion | Project: `ticket:update` |
| `moveCriterionAction` | Reorder | Project: `ticket:update` |

### Custom fields — `tickets/field-actions.ts`

| Action | Does | Permission |
|---|---|---|
| `upsertCustomFieldAction` | Create or edit a project field | Project: `project:manage-config` |
| `deleteCustomFieldAction` | Remove a field | Project: `project:manage-config` |
| `setFieldValueAction` | Set a ticket's value for a field | Project: `ticket:update` |

### Projects — `projects/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `createProjectAction` | Create a project from a template (its workflow, and optionally its starter tickets), with owner and members | `project:create` |
| `updateProjectAction` | Name, description, status, dates, owner | Project: `project:update` |
| `archiveProjectAction` | Archive or restore | Project: `project:archive` |
| `updateProjectSettingsAction` | Colour, icon, logo, rollup, subtasks, required due date, privacy, default assignee, default landing view | Project: `project:manage-config` |
| `addMembersAction` / `updateMemberRoleAction` / `removeMemberAction` | Direct membership and its role (Manager, Member, Viewer) | Project: `project:manage-members` |
| `attachTeamAction` / `detachTeamAction` | Staff a project with a team at a role | Project: `project:manage-members` |
| `searchAssignableUsers` | Directory of active users for pickers | Signed in |

### Project configuration — `projects/config-actions.ts`

| Action | Does | Permission |
|---|---|---|
| `upsertStatusAction` / `reorderStatusesAction` / `deleteStatusAction` | Statuses, their category, WIP limit and entry requirements; deleting moves its tickets | Project: `project:manage-config` |
| `upsertPriorityAction` / `deletePriorityAction` | Priorities and their response/resolution targets | Project: `project:manage-config` |
| `upsertTicketTypeAction` / `deleteTicketTypeAction` | Types, their kind and template | Project: `project:manage-config` |
| `updateFlowSettingsAction` | Stuck threshold (days) and which ticket kinds service targets apply to | Project: `project:manage-config` |
| `updateBillingSettingsAction` | Hourly rate and currency | Project: `project:manage-config` |

### Labels — `labels/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `createLabelAction` | Create a label | Project: `label:create` |
| `updateLabelAction` | Rename or recolour | Project: `label:update` |
| `deleteLabelAction` | Delete | Project: `label:delete` |
| `importLabelsAction` | Copy labels from another project, skipping names that exist | `label:create` in the target; view of the source |

### Cycles and planning — `cycles/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `createCycleAction` / `updateCycleAction` / `deleteCycleAction` | Sprints and milestones | Project: `project:manage-config` |
| `startCycleAction` | Start a planned sprint | Project: `project:manage-config` |
| `closeCycleAction` | Close, carrying unfinished work to another cycle or the backlog | Project: `project:manage-config` |
| `planTicketsAction` | Move tickets into a cycle or back to the backlog | Project: `ticket:update` |
| `arrangeAction` | Drag on the Plan page; re-ranks the list | Project: `ticket:update` |
| `proposeFillAction` | Top of the backlog until the cycle is full; writes nothing | Project: `ticket:update` + `ai:use` |
| `askPlannerAction` | The Planner agent's proposal (one model call); writes nothing | Project: `ticket:update` + `ai:use` |
| `applyScopeAction` | Apply a proposal: exactly the keys shown, backlog tickets only | via `planTicketsAction` |

### Time — `time/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `startTimerAction` | Start a timer (stops any running one) | Project: `ticket:update` |
| `stopTimerAction` | Stop your running timer | Signed in |
| `logTimeAction` | Log a duration by hand | Project: `ticket:update` |
| `updateTimeEntryAction` | Change duration, note, billable | Your own entries only |
| `deleteTimeEntryAction` | Delete an entry; audited | Your own, or anyone's with project `project:manage-config` |

### Attachments — `attachments/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `uploadAttachmentAction` | Upload from `FormData` (5 MB each, 20 per ticket) | Project: `ticket:update` |
| `deleteAttachmentAction` | Remove an attachment; the bytes cascade | Project: `ticket:update` |
| `listAttachments` | Metadata for a ticket's files | Project view |

### Portal, profile and email-in

| Action | File | Does | Permission |
|---|---|---|---|
| `approveTicketAction` | `portal/actions.ts` | Review → Done, and only that | Project: `ticket:approve` |
| `uploadAvatarAction` / `removeAvatarAction` | `profile/actions.ts` | Your own photo | Signed in |
| `updateInboundSettingAction` | `inbound-email/actions.ts` | Turn email-in on, and AI structuring | `integration:manage` |
| `checkMailboxNowAction` | `inbound-email/actions.ts` | Poll the mailbox now | `integration:manage` |
| `setProjectEmailIntakeAction` | `inbound-email/actions.ts` | Allow email-in for a project | Project: `project:manage-config` |

### Recurring — `recurring/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `upsertRecurringAction` | Create or edit a schedule | Project: `recurring:manage` |
| `toggleRecurringAction` | Pause or resume | Project: `recurring:manage` |
| `deleteRecurringAction` | Delete | Project: `recurring:manage` |
| `runRecurringNowAction` | Generate now, for testing; refuses a paused schedule | Project: `recurring:manage` |

### Filters, palette, notifications

| Action | File | Does | Permission |
|---|---|---|---|
| `saveFilterAction` | `filters/actions.ts` | Save a view, private or shared | Signed in |
| `deleteFilterAction` | `filters/actions.ts` | Delete a saved filter | Owner, or `project:access-all` |
| `listSavedFilters` | `filters/actions.ts` | Your filters plus shared ones | Signed in |
| `interpretFilterAction` | `filters/actions.ts` | Plain English to filter settings; writes nothing | Project view + `ai:use` |
| `paletteSearchAction` | `command/actions.ts` | Command palette search; an exact key is pinned first | Signed in; visible tickets only |
| `getTicketQuickActionsAction` | `command/actions.ts` | Statuses and members for the palette's ticket sub-view | Signed in; editing options only with `ticket:update` in the project |
| `markNotificationReadAction` / `markAllReadAction` | `notifications/actions.ts` | Read state | Signed in; own notifications |
| `fetchNotificationsAction` | `notifications/actions.ts` | Polled by the header bell | Signed in |
| `setNotificationSoundAction` / `setEmailPreferenceAction` | `notifications/actions.ts` | Your chime and email preferences | Signed in; self only |

### People, roles and teams

| Action | File | Does | Permission |
|---|---|---|---|
| `loginAction` | `auth/actions.ts` | Credentials sign-in; audits `LOGGED_IN` | public |
| `logoutAction` | `auth/actions.ts` | Sign out, to `/login` | — |
| `createUserAction` | `auth/actions.ts` | Create an account and send the welcome email | `user:create`; the role granted must rank below yours |
| `updateUserAction` | `auth/actions.ts` | Edit name, email, title, role | `user:update`; seniority; role granted below yours |
| `setUserActiveAction` | `auth/actions.ts` | Deactivate (ends sessions) or reactivate | `user:deactivate`; seniority |
| `adminResetPasswordAction` | `auth/actions.ts` | Set a new password, optionally forcing a change at next sign-in; ends existing sessions | `user:reset-password`; seniority |
| `changePasswordAction` | `auth/actions.ts` | Change your own password (checks the current one) | Signed in |
| `updateProfileAction` | `auth/actions.ts` | Your name and job title | Signed in |
| `listSessionsAction` | `auth/actions.ts` | Sign-in history | `user:view` |
| `revokeUserSessionsAction` | `auth/actions.ts` | End every session for a user (bumps `sessionVersion`) | `user:deactivate`; seniority |
| `createRoleAction` | `roles/actions.ts` | New role, ranked below yours, with only permissions you hold | `role:manage` |
| `updateRoleAction` | `roles/actions.ts` | Edit a role ranked below yours; Admin is locked | `role:manage` |
| `deleteRoleAction` | `roles/actions.ts` | Delete a custom role ranked below yours | `role:manage` |
| `createTeamAction` / `updateTeamAction` / `deleteTeamAction` | `teams/actions.ts` | Teams | `team:manage` |
| `setTeamMemberAction` | `teams/actions.ts` | Add a member or set manager | `team:manage`, or `team:manage-members` as a manager of that team (appointing managers needs `team:manage`); seniority |
| `removeTeamMemberAction` | `teams/actions.ts` | Remove a member | As above |
| `createTokenAction` | `tokens/actions.ts` | New personal access token, shown once | Signed in; own tokens |
| `revokeTokenAction` | `tokens/actions.ts` | Revoke | Own, or `user:update` |
| `listTokensAction` | `tokens/actions.ts` | Your tokens | Signed in |

### AI Copilot — `ai/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `copilotAction` | One Copilot turn: up to four tool rounds; writes are proposed unless `approve` is set | `ai:use` |
| `getAiStatusAction` | Whether the panel should offer itself | Signed in |
| `captureAction` | Notes in, proposed breakdown out; writes nothing | `ai:use` |
| `confirmCaptureAction` | Create the approved breakdown through the executor | `ai:use` (plus `ticket:create` via the executor) |
| `slashAction` | Run a slash command with no model call; writes still propose then confirm | `ai:use` |

### AI agents, code and releases

| Action | File | Does | Permission |
|---|---|---|---|
| `startAiFixAction` | `ai-fix/actions.ts` | Start "Fix with AI" (runs in `after()`, opens a pull request; merges only under the project's auto-merge policy) | Project: `ticket:update` + `ai:code` + within budget |
| `healPullRequestAction` | `ai-fix/actions.ts` | "Fix failing checks" on an open pull request | As `startAiFixAction` |
| `startScaffoldAction` | `ai-fix/actions.ts` | Create a repository as the person, link it, and have the Coder build a first version | Project: `project:manage-config` + `ai:code` + within budget |
| `reviewPullRequestAction` | `ai-review/actions.ts` | AI review with line comments and per-criterion verdicts | Project: `ticket:update` + `ai:code` + within budget |
| `draftReleaseNotesAction` | `releases/actions.ts` | Draft release notes; optionally publish a GitHub release | Project: `ticket:update` (draft) or `project:manage-config` (publish) + `ai:use` + within budget |
| `draftPostmortemAction` | `incidents/actions.ts` | Draft a post-mortem on an incident ticket | Project: `ticket:update` + `ai:use` + within budget |
| `generateStatusReportAction` | `reports/actions.ts` | The weekly update, with its source facts | `ai:use` |
| `undoTriageAction` | `triage-agent/actions.ts` | Undo what the triage agent set, except fields changed since | Project: `ticket:update` |

### Project memory — `memory/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `generateHandbookAction` | Generate a new handbook version | Project: `project:manage-config` |
| `saveHandbookAction` | Save a person's revision as a new version | Project: `project:manage-config` |
| `markHandbookReadAction` | Record that you read a version | Project view |
| `setProjectToggleAction` | `memoryEnabled`, `handbookAutoRefresh`, `triageAgent`, `dailyDigest`, `liveUpdates` | Project: `project:manage-config` |
| `reindexMemoryAction` | Rebuild the project's memory index now | Project: `project:manage-config` |

### Import — `import/actions.ts`

| Action | Does | Permission |
|---|---|---|
| `importBatchAction` | Import up to 200 normalised items (Jira, Trello or CSV) with confirmed mappings; skips refs already imported; notifies nobody | Project: `project:manage-config` |
| `linkImportedParentsAction` | Link children to parents by original key once every batch has landed | Project: `project:manage-config` |

### Integrations

| Action | File | Does | Permission |
|---|---|---|---|
| `refreshGithubAction` | `github/actions.ts` | Re-read the app's installations | `integration:manage` |
| `setWebhookUrlAction` | `github/actions.ts` | Point the GitHub App's webhook at `<base>/api/github/webhook`, or switch it off | `integration:manage` |
| `forgetGithubAppAction` | `github/actions.ts` | Forget the stored app (it stays on GitHub) | `integration:manage` |
| `linkRepoAction` / `unlinkRepoAction` / `setRepoRoleAction` | `github/actions.ts` | Link repositories to a project, with a role | Project: `project:manage-config` |
| `setGithubAutomationAction` | `github/actions.ts` | Status automation on or off | Project: `project:manage-config` |
| `setAiWorkflowsAction` | `github/actions.ts` | Let AI fixes write workflow files; audited | Project: `project:manage-config` |
| `setAutoMergePolicyAction` | `github/actions.ts` | Auto-merge limits: size and ticket kinds | Project: `project:manage-config` |
| `syncProjectReposAction` | `github/actions.ts` | Reconcile the project's repositories now | Project: `ticket:update` |
| `disconnectGithubAction` | `github/user-actions.ts` | Disconnect your own GitHub account | Signed in |
| `saveTeamsAction` / `disconnectTeamsAction` | `msteams/actions.ts` | Connect the Teams bot (credentials checked with Microsoft first) or disconnect | `integration:manage` |
| `saveVercelTokenAction` | `vercel/actions.ts` | Store a Vercel token | `integration:manage` |
| `rollbackAction` | `vercel/actions.ts` | Roll production back to a deployment | Project: `project:manage-config` |
| `createWebhookAction` | `webhooks-out/actions.ts` | Add an outbound webhook; returns the secret once | `integration:manage` |
| `setWebhookActiveAction` / `deleteWebhookAction` | `webhooks-out/actions.ts` | Pause, resume, delete | `integration:manage` |
| `testWebhookAction` | `webhooks-out/actions.ts` | Deliver a `ping` now | `integration:manage` |
| `retryJobsAction` | `webhooks-out/actions.ts` | Retry every failed background job | `integration:manage` |
| `createMonitorAction` / `deleteMonitorAction` / `checkMonitorNowAction` | `monitors/actions.ts` | Uptime monitors | Project: `project:manage-config` |
| `rotateErrorIngestAction` | `errors/actions.ts` | New error-ingest URL; old one stops working | Project: `project:manage-config` |

### AI administration — `ai-admin/actions.ts`

All need `ai:manage`, and changes to cost or visibility are audited.

| Action | Does |
|---|---|
| `saveEngineAction` | Enable an engine, choose its model, billing plan, base URL (custom engine) and key |
| `testEngineAction` | One tiny request to check a key and model |
| `saveWorkspaceAiAction` | Which engine serves the Copilot and which serves fixes |
| `savePriceAction` / `revertToListPriceAction` / `refreshPricesAction` | Hand-set or list prices per model |
| `saveBudgetAction` / `deleteBudgetAction` | Spending limits |
| `subscribeAction` / `unsubscribeAction` | Subscribe a person or team to `AI_USAGE_WEEKLY` or `AI_BUDGET_ALERT` |
| `sendReportNowAction` | Send the usage report now |
| `setAgentModelAction` | Give one agent its own engine and model, or return it to the default |

---

## 6. ActionResult and error codes

Every Server Action resolves to a discriminated union and never throws across
the server/client boundary (`src/core/domain/result.ts`):

```ts
type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; fieldErrors?: Record<string, string[]> }
```

Actions wrap their bodies in `runAction` (`src/lib/safe-action.ts`), which
translates whatever is thrown:

| Thrown | `code` | `error` |
|---|---|---|
| `ZodError` | `VALIDATION_ERROR` | "Please correct the highlighted fields.", with `fieldErrors` |
| `ValidationError` | `VALIDATION_ERROR` | its message, with its `fieldErrors` |
| `NotFoundError` | `NOT_FOUND` | `Ticket "DEMO-99" was not found.` |
| `UnauthorizedError` | `UNAUTHORIZED` | "You must be signed in to do that." |
| `ForbiddenError` | `FORBIDDEN` | the guard's message, e.g. "Your role does not allow this action (ticket:delete)." |
| `ConflictError` | `CONFLICT` | its message |
| `BusinessRuleError` | `BUSINESS_RULE` | the rule's explanation |
| Prisma `P2002` (unique) | `CONFLICT` | "That {field} is already in use." |
| Prisma `P2003` (foreign key) | `FK_VIOLATION` | "That change references a record that no longer exists." |
| Prisma `P2025` (not found) | `NOT_FOUND` | "The record was not found — it may have been deleted." |
| Next.js `redirect()` / `notFound()` | — | re-thrown untouched |
| Anything else | `INTERNAL` | "Something went wrong. Please try again." (the real error is logged server-side) |

Codes an action returns directly with `fail()`:

| `code` | Where |
|---|---|
| `CONFLICT` | `updateTicketAction` when `expectedUpdatedAt` no longer matches ("Someone else changed this ticket…"); duplicate username or email in `createUserAction` |
| `INVALID_CREDENTIALS` | `loginAction` — deliberately one message for a wrong password, an unknown user and a deactivated account |
| `AI_DISABLED` | `copilotAction`, `captureAction`, `interpretFilterAction`, `generateStatusReportAction` when no AI provider is configured |
| `AI_PROVIDER` | `copilotAction` when the provider call fails |
| `NOT_FOUND` | a few actions, e.g. `setTeamMemberAction` for a deleted user |
| *(none)* | many business refusals return `fail(message)` with no code; show `error` |

The HTTP status on each `DomainError` (401, 403, 404, 409, 400, 422) is used only
where a route handler turns one into a response, as the REST API and MCP bridge
do.

---

## 7. Permission catalogue

The catalogue is code (`PERMISSIONS` in `src/core/domain/rbac.ts`); which role
holds which permission is data (`role_permissions`). A permission row the code no
longer defines is ignored when roles are resolved.

Ranks: lower is more senior. Admin `0`, Project Manager `20`, User `40`, and the
Client role (created by migration, not a system role) `80`.

| Permission | Label | Admin | Project Manager | User | Client | Note |
|---|---|:-:|:-:|:-:|:-:|---|
| `user:view` | View people | ✓ | ✓ | | | |
| `user:create` | Add people | ✓ | | | | |
| `user:update` | Edit people | ✓ | | | | Only people ranked below them |
| `user:deactivate` | Deactivate people | ✓ | | | | |
| `user:reset-password` | Reset passwords | ✓ | | | | |
| `role:manage` | Manage roles | ✓ | | | | Never above their own rank |
| `team:manage` | Create and edit teams | ✓ | | | | |
| `team:manage-members` | Manage own team members | ✓ | ✓ | | | Only teams they manage |
| `project:view` | View projects | ✓ | ✓ | ✓ | ✓ | |
| `project:create` | Create projects | ✓ | ✓ | | | |
| `project:update` | Edit project details | ✓ | ✓ | | | Manager-scoped |
| `project:manage-members` | Manage project members | ✓ | ✓ | | | Manager-scoped |
| `project:manage-config` | Configure statuses, priorities and types | ✓ | ✓ | | | Manager-scoped |
| `project:archive` | Archive projects | ✓ | ✓ | | | Manager-scoped |
| `project:delete` | Delete projects | ✓ | | | | |
| `project:view-all` | See every project | ✓ | ✓ | | | Visibility only |
| `project:access-all` | Act in every project | ✓ | | | | Waives membership |
| `ticket:create` | Create tickets | ✓ | ✓ | ✓ | ✓ | |
| `ticket:update` | Edit tickets | ✓ | ✓ | ✓ | | Own or reported, unless `ticket:update-any` |
| `ticket:update-any` | Edit anyone's ticket | ✓ | ✓ | | | Also bulk edit and archive |
| `ticket:transition` | Change status | ✓ | ✓ | ✓ | | Board drag |
| `ticket:approve` | Approve work in review | ✓ | ✓ | | ✓ | Review → Done only |
| `ticket:assign` | Assign tickets | ✓ | ✓ | | | |
| `ticket:delete` | Delete tickets | ✓ | ✓ | | | |
| `comment:create` | Comment | ✓ | ✓ | ✓ | ✓ | |
| `comment:delete-any` | Delete anyone's comment | ✓ | ✓ | | | |
| `label:create` | Create labels | ✓ | ✓ | | | Manager-scoped |
| `label:update` | Edit labels | ✓ | ✓ | | | Manager-scoped |
| `label:delete` | Delete labels | ✓ | ✓ | | | Manager-scoped |
| `recurring:manage` | Manage recurring tickets | ✓ | ✓ | | | Manager-scoped |
| `ai:use` | Use the AI Copilot | ✓ | ✓ | ✓ | | |
| `integration:manage` | Manage integrations | ✓ | | | | Sees every repository the app can reach |
| `ai:code` | Fix tickets with AI | ✓ | | | | Costs money per run; merges only under a project's auto-merge policy |
| `ai:manage` | Manage AI engines and budgets | ✓ | | | | Sees usage by person |
| `template:manage` | Manage project templates | ✓ | | | | |
| `audit:view-all` | View the full activity log | ✓ | | | | |

The columns are the defaults the code and migrations set. Administrators can edit
Project Manager, User and Client (Admin is locked), so a running workspace may
differ; *Workspace → Roles* shows what is actually granted.

Inside a project, a held permission also needs scope (`canInProject`):
`project:access-all` waives it; otherwise the actor must own the project or have
a project role, the manager-scoped permissions above need owner or `MANAGER`,
and any `:create`, `:update`, `:delete`, `:transition` or `:assign` needs owner,
`MANAGER` or `MEMBER` — a `VIEWER` is read-only.
