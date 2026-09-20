# MCP Server

TaskForge ships a [Model Context Protocol](https://modelcontextprotocol.io)
server, so Claude Desktop, Claude Code or any MCP client can manage your
tickets directly.

```
Claude  ──stdio──►  mcp/server.ts  ──HTTPS + Bearer──►  /api/mcp
                                                             │
                                                  guard → validate
                                                  → transact → audit
```

## The security property

The server is deliberately thin — no business logic, no database access. It
forwards calls to the deployed app, which resolves the token into **the same
`Actor` a browser session produces**.

That single fact carries the whole model:

- An agent inherits its user's role **exactly**. A `USER` token cannot reach an
  admin route any more than that person could in the UI.
- Project scoping applies unchanged. An agent cannot read a project its user
  is not a member of.
- Every action is audited under the user's name, in the same transaction as the
  change.
- **There is no delete tool.** "Delete everything" is not a request the protocol
  can express.

There is no service account and no elevated path. Nothing in the MCP server
could grant more access, because it has none of its own to give.

---

## Setup

### 1. Create a token

**Settings → Access tokens → New token.** It is shown once. Only a SHA-256 hash
is stored, so a database leak yields nothing usable.

### 2. Point a client at it

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "taskforge": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/taskforge/mcp/server.ts"],
      "env": {
        "TASKFORGE_URL": "https://your-app.vercel.app",
        "TASKFORGE_TOKEN": "tf_...",
        "TASKFORGE_PROJECT": "ATLAS"
      }
    }
  }
}
```

**Claude Code** — copy the template and export the variables:

```bash
cp .mcp.json.example .mcp.json
```

```bash
export TASKFORGE_URL=https://your-app.vercel.app
export TASKFORGE_TOKEN=tf_...
export TASKFORGE_PROJECT=RC        # optional default project
```

The template uses `${VAR}` expansion deliberately, and the real `.mcp.json` is
git-ignored: a literal token in a committed file is a leaked token, and this
repository is public.

Note that defining the server in **both** project and local scope makes Claude
Code warn about duplicate endpoints — pick one.

To register it with the credential kept out of the repository entirely, use
local scope instead — this writes to `~/.claude.json`, not the project:

```bash
claude mcp add taskforge --scope local \
  --env TASKFORGE_URL=https://your-app.vercel.app \
  --env TASKFORGE_TOKEN=tf_... \
  --env TASKFORGE_PROJECT=RC \
  -- npx tsx /absolute/path/to/taskforge/mcp/server.ts
```

Verify with `claude mcp list` — it should report `✔ Connected`.

| Variable | Required | Purpose |
|---|---|---|
| `TASKFORGE_URL` | ✅ | Deployment origin, no trailing slash |
| `TASKFORGE_TOKEN` | ✅ | Personal access token |
| `TASKFORGE_PROJECT` | — | Default project code, so "create a ticket" needs no project named |

---

## Tools

The catalogue is fetched from the deployment at startup, so adding a tool
server-side requires no change here.

| Tool | Effect |
|---|---|
| `search_tickets` | Read — filters, or free text |
| `get_ticket` | Read — one ticket in full, including its children and recent comments |
| `project_insights` | Read — description, dates, team, labels, health |
| `find_duplicates` | Read — semantic similarity plus word overlap |
| `create_ticket` | **Write** |
| `bulk_create_tickets` | **Write** — parent + children in one transaction |
| `update_ticket` | **Write** — status, assignee, priority, due date, labels |
| `comment_on_ticket` | **Write** — `@username` notifies that person |

`get_ticket` and `search_tickets` answer different questions. Search returns
rows to scan; `get_ticket` returns everything needed to *act* on one piece of
work — description, remarks, labels, dates, parent, children and the last ten
comments.

`comment_on_ticket` routes through the same Server Action the comment box uses,
so mentions are resolved, the people mentioned are notified and the activity
entry is written in the same transaction. An agent commenting is recorded as
the person whose token it holds:

```
audited as: @admin — commented on LOAD5-967
```

### In practice

```
"What's blocked in ATLAS?"
"How is the Payments Service doing?"
"Create a ticket: login returns 500 after password reset, high priority"
"Break the authentication module into Login API, Login UI, Password Reset"
"Move ATLAS-14 to Testing and assign it to Arjun"
"Read ATLAS-14 and tell me what is left to do"
"Comment on ATLAS-14 that the fix is deployed, and mention @arjun.mehta"
```

---

## HTTP API

The endpoint is usable without MCP.

```bash
# Catalogue: who you are, what you can see, what you can call
curl -H "Authorization: Bearer $TOKEN" https://your-app.vercel.app/api/mcp

# Call a tool
curl -X POST https://your-app.vercel.app/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"search_tickets","arguments":{"statusCategory":"BLOCKED"},"projectCode":"ATLAS"}'
```

```json
{ "ok": true, "summary": "Found 2 matching tickets:\nATLAS-7 — Login UI [Blocked, High, Daniel Okoro]…" }
```

| Status | Meaning |
|---|---|
| `200` | Tool ran |
| `401` | Missing, revoked, expired token, or a deactivated user |
| `404` | Unknown tool |
| `403` | The actor lacks permission — a legitimate answer, not a fault |
| `422` | Tool ran and refused, e.g. schema validation |

---

## Notes

**Token lifecycle.** A token stops working the moment it is revoked, expires, or
its user is deactivated — a deactivated employee's agents lose access without
anyone hunting down individual tokens.

**Why SHA-256 and not bcrypt.** The token is 32 bytes of CSPRNG output, so there
is no entropy to stretch, and a machine client presents it on every call — a
slow KDF would be a self-inflicted bottleneck. bcrypt remains correct for
passwords, which are low-entropy and human-chosen.

**Writes execute directly over MCP.** The in-app Copilot proposes writes and
waits for approval, but MCP clients present their own tool-call confirmation, so
proposing again would mean approving twice for one action. An agent asked to
create fifty tickets will create fifty tickets — every one is audited and
reversible, but treat a write-capable token accordingly.
