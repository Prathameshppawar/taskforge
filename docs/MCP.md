# MCP Server

TaskForge ships a [Model Context Protocol](https://modelcontextprotocol.io)
server, so Claude Desktop, Claude Code or any other MCP client can read and
manage tickets with the same tools the in-app Copilot uses. For scripts and
integrations that do not speak MCP, the same tools are available as a plain
HTTP endpoint and as the REST API v1.

Checked against the code on 29 September 2026.

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [The security property](#2-the-security-property)
3. [Access tokens](#3-access-tokens)
4. [Running the server](#4-running-the-server)
5. [Tools](#5-tools)
6. [Example calls](#6-example-calls)
7. [Permissions and audit](#7-permissions-and-audit)
8. [The HTTP endpoint behind it](#8-the-http-endpoint-behind-it)
9. [REST API v1: the plain-HTTP alternative](#9-rest-api-v1-the-plain-http-alternative)
10. [Notes](#10-notes)

---

## 1. How it fits together

```
MCP client  ──stdio──►  mcp/server.ts  ──HTTPS + Bearer token──►  /api/mcp
(Claude…)               (no logic,                                   │
                         no database)                   token → the same Actor as a browser
                                                        → validate (Zod) → permission check
                                                        → Server Action → activity log
```

| Piece | File | Role |
|---|---|---|
| stdio bridge | [`mcp/server.ts`](../mcp/server.ts) | Speaks MCP to the client and forwards each call to the deployment. Holds no business logic and never touches the database. |
| Endpoint | [`src/app/api/mcp/route.ts`](../src/app/api/mcp/route.ts) | `GET` returns the tool catalogue; `POST` runs one tool. |
| Tools | [`src/features/ai/tools.ts`](../src/features/ai/tools.ts), [`executor.ts`](../src/features/ai/executor.ts) | The Copilot's tool contracts and dispatch — the same code for the Copilot, MCP and the REST API. |

At start-up the bridge fetches the catalogue from the deployment, so the tool list
always matches what is deployed and adding a tool server-side needs no change to
the bridge (restart the client to pick it up).

## 2. The security property

The deployment resolves the token into **the same `Actor` a browser session
produces** ([`getCurrentUser`](../src/features/auth/guards.ts)). Everything
follows from that:

- An agent has exactly its user's role and permissions — no more. A token cannot
  reach a capability a signed-in session could not.
- Project visibility applies unchanged: an agent cannot read or write a project
  its user cannot see.
- Every write goes through the same Server Action as the button in the UI, and is
  recorded in the activity log under the user's name, in the same transaction as
  the change.
- There is no delete tool. "Delete everything" is not a request the tool surface
  can express.

There is no service account and no elevated path. The bridge could not grant more
access, because it has none of its own.

## 3. Access tokens

**Settings → Access tokens → New token.**

| | |
|---|---|
| Format | `tf_` followed by 32 bytes of random data |
| Shown | Once, when created. Only a SHA-256 hash is stored, so a database leak yields nothing usable. |
| Name | Required; shown in the list so you know which client holds which |
| Expiry | 1–365 days, or none |
| Last used | Updated on each call (best effort) |
| Revoking | Your own tokens; an administrator with `user:update` can revoke anyone's |

A token stops working the moment it is revoked, expires, or its user is
deactivated — a departing person's agents lose access without anyone hunting down
individual tokens. The endpoint never says which of those applied, so it cannot be
used to probe which tokens exist. Creating and revoking tokens are recorded in the
activity log.

SHA-256 rather than bcrypt is deliberate: the token has 256 bits of entropy, so
there is nothing for a slow hash to stretch, and a machine client presents it on
every call.

## 4. Running the server

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `TASKFORGE_URL` | Yes | The deployment's origin, e.g. `https://your-app.vercel.app` (a trailing slash is removed) |
| `TASKFORGE_TOKEN` | Yes | A personal access token (`tf_…`) |
| `TASKFORGE_PROJECT` | No | A default project code, sent with every call, so "create a ticket" needs no project named. A code the token's user cannot see is ignored. |

Without the first two the bridge exits with a message on stderr. It logs only to
stderr — stdout is the protocol channel, and a stray byte there corrupts it. On
start it reports, on stderr, how many tools it has, as whom, and how many projects
are visible.

### Run it directly

```bash
TASKFORGE_URL=https://your-app.vercel.app \
TASKFORGE_TOKEN=tf_... \
TASKFORGE_PROJECT=DEMO \
npx tsx mcp/server.ts
```

### Claude Code

The repository has a template. Copy it and export the variables:

```bash
cp .mcp.json.example .mcp.json
export TASKFORGE_URL=https://your-app.vercel.app
export TASKFORGE_TOKEN=tf_...
export TASKFORGE_PROJECT=DEMO      # optional
```

The template uses `${VAR}` expansion on purpose, and `.mcp.json` is git-ignored: a
literal token in a committed file is a leaked token.

To keep the credential out of the repository entirely, register it in local scope
instead (written to `~/.claude.json`):

```bash
claude mcp add taskforge --scope local \
  --env TASKFORGE_URL=https://your-app.vercel.app \
  --env TASKFORGE_TOKEN=tf_... \
  --env TASKFORGE_PROJECT=DEMO \
  -- npx tsx /absolute/path/to/taskforge/mcp/server.ts
```

Use one scope or the other — defining it in both makes Claude Code warn about a
duplicate server. `claude mcp list` should report it as connected.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "taskforge": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/taskforge/mcp/server.ts"],
      "env": {
        "TASKFORGE_URL": "https://your-app.vercel.app",
        "TASKFORGE_TOKEN": "tf_...",
        "TASKFORGE_PROJECT": "DEMO"
      }
    }
  }
}
```

## 5. Tools

From `TOOL_SCHEMAS` in [`tools.ts`](../src/features/ai/tools.ts). Names — of
projects, people, statuses, priorities, types, labels — are resolved server-side
against the project, exactly as for the Copilot. Where a project is optional, the
`projectCode` argument wins, then `TASKFORGE_PROJECT`; with neither, the tool
replies asking which project.

Numbers are clamped rather than rejected, and a `null` in an optional field is
treated as absent.

### Reads

**`search_tickets`** — find tickets by filter or free text.

| Argument | Type | |
|---|---|---|
| `query` | string | Free text |
| `projectCode` | string | Omit to use the default project; with none, every project the user can see. Status, priority, type and label names only resolve within a project. |
| `status` | string | A named status, e.g. `In Review` |
| `statusCategory` | enum | `BACKLOG`, `TODO`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`, `CANCELLED` |
| `priority`, `type`, `label` | string | By name |
| `assignee` | string | Username, name, or `me` |
| `overdueOnly`, `unassignedOnly` | boolean | |
| `limit` | integer | 1–50, default 15 |

**`get_ticket`** — one ticket in full: description, remarks, labels, dates, parent
and children, acceptance criteria and how many are met, linked pull requests with
their CI state, deployments (stated as "none recorded" when there are none), and
recent comments.

| Argument | Type | |
|---|---|---|
| `ticketKey` | string, required | e.g. `DEMO-14` |

**`project_insights`** — a project's facts and health: description, dates, owner,
team, priorities, linked repositories, last successful deploy, completion, overdue
work and workload.

| Argument | Type | |
|---|---|---|
| `projectCode` | string | |

**`find_duplicates`** — similar existing tickets, by meaning and by word overlap.

| Argument | Type | |
|---|---|---|
| `title` | string, required | At least 3 characters |
| `projectCode` | string | |

**`search_memory`** — the project's memory: finished tickets and how they were
resolved, linked repositories' documentation, and the handbook. Up to five
matches, each with a key or link. Empty when memory is off for the project or
embeddings are disabled on the deployment.

| Argument | Type | |
|---|---|---|
| `query` | string, required | 3–300 characters |
| `projectCode` | string | |

### Writes

**`create_ticket`**

| Argument | Type | |
|---|---|---|
| `title` | string, required | 3–200 characters |
| `description` | string | Up to 5,000 characters, Markdown |
| `projectCode` | string | |
| `priority` | string | e.g. `Low`, `Medium`, `High`, `Critical`, `Blocker` |
| `type` | string | e.g. `Task`, `Bug`, `Story`, `Improvement`, `Research`, `Hotfix` |
| `status` | string | |
| `assignee` | string | Username or name |
| `labels` | string[] | |
| `dueInDays` | integer | 0–3,650 |
| `parentKey` | string | e.g. `DEMO-4` |
| `acceptanceCriteria` | string[] | Up to 12, one line each (300 characters) |

**`bulk_create_tickets`** — a parent and its child tasks, in one go.

| Argument | Type | |
|---|---|---|
| `parentTitle` | string, required | 3–200 characters |
| `parentDescription` | string | Up to 5,000 characters |
| `projectCode` | string | |
| `children` | array, required | 1–30 items, each `{ title (required), description?, assignee?, labels? }` |

**`update_ticket`**

| Argument | Type | |
|---|---|---|
| `ticketKey` | string, required | |
| `status` | string | A status name |
| `priority` | string | |
| `assignee` | string | Name, or `none` to unassign |
| `dueInDays` | integer | |
| `addLabels` | string[] | Adds; never removes |
| `title` | string | 3–200 characters |

**`comment_on_ticket`** — through the same Server Action as the comment box, so
`@username` mentions are resolved and notified.

| Argument | Type | |
|---|---|---|
| `ticketKey` | string, required | |
| `body` | string, required | 1–5,000 characters, Markdown |

## 6. Example calls

What a person might say to an MCP client, and the call it should make:

| Said | Tool and arguments |
|---|---|
| "What's blocked in DEMO?" | `search_tickets { "projectCode": "DEMO", "statusCategory": "BLOCKED" }` |
| "What have I got that's overdue?" | `search_tickets { "assignee": "me", "overdueOnly": true }` |
| "Read DEMO-14 and tell me what's left" | `get_ticket { "ticketKey": "DEMO-14" }` |
| "How is the Payments project doing?" | `project_insights { "projectCode": "PAY" }` |
| "How did we add Apple Pay last time?" | `search_memory { "query": "adding Apple Pay", "projectCode": "PAY" }` |
| "Is there already a ticket for the login 500?" | `find_duplicates { "title": "Login returns 500 after password reset" }` |
| "Create a high-priority bug: login returns 500 after password reset" | `create_ticket { "title": "Login returns 500 after password reset", "type": "Bug", "priority": "High" }` |
| "Break authentication into Login API, Login UI and Password Reset" | `bulk_create_tickets { "parentTitle": "Authentication", "children": [ { "title": "Login API" }, { "title": "Login UI" }, { "title": "Password reset" } ] }` |
| "Move DEMO-14 to Testing and give it to Arjun" | `update_ticket { "ticketKey": "DEMO-14", "status": "Testing", "assignee": "Arjun" }` |
| "Tell @arjun.mehta on DEMO-14 that the fix is deployed" | `comment_on_ticket { "ticketKey": "DEMO-14", "body": "@arjun.mehta the fix is deployed." }` |

The tool's reply is plain text written for a model to read — for example:

```
Found 2 matching tickets:
DEMO-7 — Login UI [Blocked, High, Daniel Okoro] …
```

A refused or failed tool is returned to the client as an error result
(`isError: true`), so the model can react instead of reporting success.

## 7. Permissions and audit

**Writes execute directly.** The in-app Copilot proposes a write and waits for the
person to approve it. Over MCP there is no proposal step: MCP clients show their
own tool-call confirmation, and asking again would mean approving twice. An agent
asked to create fifty tickets will create fifty tickets. Every one is audited and
can be edited or undone by hand, but treat a write-capable token accordingly — a
token for a role with narrower permissions is a narrower agent.

**Checks, per tool** — the same as in the UI, for the token's user:

| Tool | Needs |
|---|---|
| Reads | Visibility of the project or ticket; anything not visible is reported as not found |
| `create_ticket`, `bulk_create_tickets` | `ticket:create` on the project; the project must not be archived |
| `update_ticket` | `ticket:update` on the ticket's project (and whatever the status's entry rules require) |
| `comment_on_ticket` | `comment:create` on the ticket's project |

The endpoint does not require `ai:use`: no model runs on TaskForge's side for an
MCP call, so nothing is metered on the AI usage ledger either. The client's own
model is the one doing the thinking.

**Audit.** Each write is recorded in the activity log under the token's user,
exactly as if they had done it by hand — for example "@admin commented on
DEMO-14". Mentions notify, assignments notify, and webhooks fire, because the same
Server Actions run.

## 8. The HTTP endpoint behind it

The bridge is a convenience; `/api/mcp` can be called directly.

```bash
# Catalogue: who you are, which projects you can see (up to 50), which tools exist
curl -H "Authorization: Bearer $TASKFORGE_TOKEN" https://your-app.vercel.app/api/mcp
```

```json
{
  "actor": { "username": "admin", "name": "Admin", "role": "ADMIN" },
  "projects": [{ "code": "DEMO", "name": "Demo" }],
  "tools": [{ "name": "search_tickets", "description": "…", "inputSchema": { "type": "object", "properties": {} } }]
}
```

```bash
# Run one tool
curl -X POST https://your-app.vercel.app/api/mcp \
  -H "Authorization: Bearer $TASKFORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"search_tickets","arguments":{"statusCategory":"BLOCKED"},"projectCode":"DEMO"}'
```

```json
{ "ok": true, "summary": "Found 2 matching tickets:\nDEMO-7 — Login UI [Blocked, High, Daniel Okoro]…" }
```

The body is `{ tool, arguments, projectCode? }`. The reply is the tool's result:
`ok`, `summary`, and for some tools a `data` payload.

| Status | Meaning |
|---|---|
| `200` | The tool ran |
| `400` | The body was not JSON or not `{ tool, arguments }`; or a domain rule refused it |
| `401` | Missing, revoked or expired token, or a deactivated user |
| `403` | The user lacks the permission — a legitimate answer, not a fault |
| `404` | Unknown tool (the reply lists the available ones), or a record not found or not visible |
| `422` | The tool ran and refused — invalid arguments, an unresolvable name, a failed action |
| `500` | Unexpected; logged server-side, with a generic message |

## 9. REST API v1: the plain-HTTP alternative

For integrations that want resource-shaped URLs rather than tool calls,
`/api/v1` is a thin REST shape over the same tools
([`src/features/public-api/handler.ts`](../src/features/public-api/handler.ts)).
Same tokens, same Actor, same schemas, same Server Actions, same audit — it has no
path of its own to get wrong.

| Method and path | Tool | Body or query |
|---|---|---|
| `GET /api/v1/projects` | — (a direct, visibility-filtered read) | — |
| `GET /api/v1/tickets` | `search_tickets` | `?project=DEMO&q=checkout&status=…&category=DONE&priority=…&type=…&label=…&assignee=me&overdue=1&unassigned=1&limit=50` |
| `POST /api/v1/tickets` | `create_ticket` | `{ project, title, description?, type?, priority?, assignee?, labels?, dueInDays?, parentKey?, acceptanceCriteria? }` |
| `GET /api/v1/tickets/DEMO-12` | `get_ticket` | — |
| `PATCH /api/v1/tickets/DEMO-12` | `update_ticket` | `{ status?, priority?, assignee?, title?, dueInDays?, addLabels? }` |
| `POST /api/v1/tickets/DEMO-12/comments` | `comment_on_ticket` | `{ body }` |

```bash
curl -X POST https://your-app.vercel.app/api/v1/tickets \
  -H "Authorization: Bearer $TASKFORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project":"DEMO","title":"Checkout button does nothing on Safari","type":"Bug","priority":"High"}'
```

```json
{ "ok": true, "message": "Created DEMO-31 — \"Checkout button does nothing on Safari\" in Demo…" }
```

Replies are `{ ok, message, data? }` (`{ ok, data }` for projects). `201` for a
created ticket or comment, `200` otherwise; `400` for a body that is not a JSON
object; `401` without a valid token; `404` for a project code the user cannot see
or a ticket that does not exist; `422` when the tool refused. Memory search,
duplicates, insights and bulk creation are MCP and `/api/mcp` only.

## 10. Notes

**Nothing extra to run.** The bridge is a script in this repository, run with
`tsx`; the endpoint is part of the deployment. There is no separate server to host
and nothing to pay for.

**Visibility of the default project.** An unknown or invisible
`TASKFORGE_PROJECT` (or `projectCode` on `/api/mcp`) is ignored rather than
reported, so a tool that needs a project will ask for one. The REST API answers
`404` in the same situation.

**Tool results are for models.** `summary` restates every row so a model can
reason about it. A person-facing integration will usually prefer the REST API's
`data` where a tool provides it.

**See also.** [AI.md](AI.md) for how the same tools behave inside the Copilot —
proposals, screen awareness, slash commands — and [API.md](API.md) for Server
Actions and route handlers.
