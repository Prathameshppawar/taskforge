# What more we could do

Ideas worth building, why they matter, and what they would cost — kept honest:
what was considered and rejected is here too, with reasons. Everything already
built is described in the [README](../README.md) and the [user guide](USER-GUIDE.md).

One rule governs every item: **free tiers only**. TaskForge runs on Vercel Hobby,
Neon's free Postgres, Groq's free tier and the user's own SMTP/IMAP mailbox. An
idea that needs a paid service is either rewritten to avoid it or left out.

---

## Contents

- [What the last roadmap became](#what-the-last-roadmap-became)
- [Next](#next)
- [Later](#later)
- [Scale](#scale)
- [Considered and rejected](#considered-and-rejected)

---

## What the last roadmap became

The previous version of this file (20 September 2026) listed these. All but two
shipped, several in a stronger form than proposed.

| Idea then | What exists now |
|---|---|
| Monday digest | A weekly manager digest, **and** an opt-in morning digest per project — counted from the records, emailed and posted to Teams |
| At-risk detection | Status history kept by trigger; stuck cards, WIP limits and SLA clocks that pause while blocked, with alerts at 80% and on breach |
| GitHub integration | A full GitHub App: branches, pull requests, CI and deployments on tickets, forward-only automation, several repositories per project, and the AI delivery loop on top |
| Slack | Not built. Microsoft Teams was built instead (bot, brainstorm, channel links); outbound webhooks cover Slack relays |
| Inbound email | Plus-addressed mail becomes tickets, replies become comments, with sender authentication and loop protection |
| Auto-labelling and triage | History-based triage suggestions in the create dialog, and an opt-in Triage agent with reasons and undo |
| Estimates from history | "Similar work took N days", points for triage from similar tickets, and Monte Carlo delivery forecasts |
| Comment thread summarisation | Not built — see [Next](#next) |
| pgvector at scale | Still not needed — see [Scale](#scale) |

---

## Next

### Agents that earn their autonomy

The one deliberately deferred. Each agent and model would carry a scorecard from
real outcomes — pull requests merged, reopened or reverted, review verdicts
confirmed or overruled by people — and autonomy would be granted by record: the
Coder could pick up tickets labelled *ai-ready* by itself once its merge rate in
that repository passes a threshold, and lose the right when it slips. The data is
mostly collected already (acceptance per engine feeds model recommendations).
Free; the work is the policy and its UI.

### Catch me up

Summarise a long comment thread — what was decided, what is still open, who is
waiting on whom — on the ticket and for anyone mentioned into it late. One model
call on the Copilot's engine, cached against the thread's last comment so it is
paid for once.

### Web push notifications

The installable app could receive push notifications through the browser's own
Web Push service (VAPID keys, free), so an assignment or an SLA breach reaches a
phone without email. Needs a service worker and a subscriptions table; the
notification pipeline already exists.

### Slack

The same shape as the Teams bot — a brainstorm that ends in a filed ticket, and
channels linked to projects — on Slack's free Events API. The acting-as layer and
the draft card already exist; the work is the Slack signature check and Block Kit.

### Business hours for service targets

SLA clocks run in calendar hours. Agencies promise *working* hours. A per-project
calendar (working days, hours, holidays) applied to the existing pure clock
function would make targets fair without changing how they are stored.

---

## Later

- **A public status page** per project, fed by the uptime monitors that already
  exist — static, cacheable, free.
- **Customer satisfaction** on closed client requests: one question in the portal
  and in the reply email, reported beside cycle time.
- **Recurring reports to clients by email** — the monthly report already renders;
  sending it on the first of the month is a cron line and a template.
- **Two-way calendar** — due dates to an ICS feed people can subscribe to.
- **Offline reading** in the installable app, for the ticket and handbook views.

---

## Scale

### pgvector, when a project gets big

Similarity and project memory are scored with a sequential scan inside one
project — `sum(a * b)` over a `real[]`, measured at **57 ms across 2,167 tickets**.
That keeps the app on stock Postgres (no extension: CI, a fresh clone and Neon all
behave the same). It stops being fine somewhere around **10,000 rows in one
project**, where the scan would pass ~250 ms. The answer then is a `vector(384)`
column with an HNSW index, which Neon supports; the migration is mechanical,
because the vectors are stored already and each query is isolated in one
function. The limit is per project, not per workspace.

### The free database

Neon's free tier is 0.5 GB. What grows, and what keeps it in check:

| Grows with | Kept in check by |
|---|---|
| Project memory | Capped at 3,000 pieces per project; deleted when memory is turned off |
| Attachments (stored as bytes) | 5 MB per file, 20 per ticket |
| Job queue | Finished jobs dropped after a week |
| Status and cycle history, activity log | Small rows; the first to watch if a workspace grows large |
| AI usage ledger | One row per model call |

When the database nears its limit, the order of relief is: prune old activity
and usage rows, move attachments to a free object store (Cloudflare R2's free
tier), then consider Neon's paid tier.

### Caching

Deliberately not done. Benchmarked at 26,042 tickets: every dashboard query
came in under 5 ms except `getTeamWorkload`, which was fixed by aggregating in
the database rather than by caching. A cache now would buy nothing and cost
correctness.

---

## Considered and rejected

**Held-open realtime connections.** Server-sent events or websockets would make
live updates instant, but a serverless host bills every second a connection
stays open. Live updates poll a one-line version every twenty seconds instead,
only while a tab is visible, and only where a project turns them on.

**AI-written ticket descriptions as the record.** Where a model shapes a request
— email in, the Teams brainstorm — the original text is always kept beside it,
and in the dialog people write their own. A generated paragraph nobody wrote is
not something anyone can be accountable for.

**Unbounded autonomy.** The Copilot still proposes before it writes. What acts on
its own is narrow, opt-in and reversible: auto-merge under a strict per-project
policy, auto-heal twice per pull request at most, triage only on fields left at
their defaults, with undo. An agent that silently edits tickets would make the
audit log record automation rather than decisions.

**AI-guessed estimates without history.** Confident guessing, presented as a
number somebody plans around. Forecasts replay real throughput or say they
cannot.

**Accounts created by single sign-on.** Keycloak, Google and Microsoft admit only
existing accounts. Letting a provider create them would turn "who has access" into
a question about another system's configuration.
