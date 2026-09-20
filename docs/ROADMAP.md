# What more we could do

Ideas that are worth building, why they matter, and what they would cost. Kept
honest: the ones that were considered and rejected are here too, with reasons.

Anything already built is in the [README](../README.md), not here.

---

## Push, not pull

The Copilot is a *pull* interface — you have to go and ask it. Almost everything
below is *push*: the system notices something and tells you, which is where a
ticket tool earns its keep.

### The Monday digest

Every Monday, per project: what moved, what stalled, what is overdue, what is
blocked and on whom. Delivered to the inbox that already exists.

The design point that makes it trustworthy: **detect in SQL, narrate with the
model.** Cycle time, bounce-backs from Review, tickets untouched for N days —
those are queries, and queries do not hallucinate. The model only writes the
paragraph over numbers it was handed.

- **Fits what exists.** The cron runs daily already (`/api/cron/recurring`),
  `Notification` and the inbox are built, and `getTeamWorkload` computes most of
  the numbers.
- **Cost.** One call per project per week — roughly **$0.001/month** at the
  measured 1,407 tokens per request.
- **Effort.** Moderate. The queries are the work; the prose is a prompt.

### At-risk detection

A narrower, continuous version of the same idea: a ticket is at risk when it is
past due, has not moved in longer than its type usually takes, is blocked by
something that is itself not moving, or is a child whose siblings have all
finished. Flag it on the board and in the digest.

Worth doing **without** an LLM first. The detection is a query; the explanation
is the only part that needs words.

---

## Integrations

### GitHub

The schema is already half-expecting this — `ResourceType.GITHUB` exists and
tickets carry resource links.

- A webhook that links a pull request to the ticket named in its branch
  (`RC-14-fix-sync`), comments the PR status on the ticket, and transitions to
  Done on merge.
- The signature-verification shape is already there in the `CRON_SECRET` guard.
- **Effort.** Moderate, and mostly plumbing rather than judgement.

### Slack

Two directions, of unequal value:

- **Outbound** (notifications to a channel) — easy, and largely duplicates the
  inbox that already exists. Low value on its own.
- **Inbound** (a message becomes a ticket) — genuinely useful, and now cheap:
  it is the capture flow that already exists with a different front door.

### Inbound email

`support@` becomes tickets, replies become comments. The most requested feature
in tools like this and the most tedious to build well — threading, quoting,
attachments, spam. Worth it only if the workspace actually receives email.

---

## Making the model better at this workspace

### Auto-labelling and triage

When a ticket arrives with just a title, propose the type, priority and labels —
shown as a proposal, approved in bulk.

**This one has already been done by hand.** Setting up Regency Ceramics involved
applying component labels to existing tickets by reading their titles. A batch
labeller would have done it in one pass, and the embeddings needed to match a
title against a project's label vocabulary are now in place.

Worth building *before* the next project starts, not after.

### Estimates from history

"Tickets like this one took about three weeks." Needs two things that now exist
or nearly do: semantic similarity (built) and cycle-time history from the
activity log (queryable). Grounded in real outcomes rather than the model's
guess, which is the only version worth shipping.

### Comment thread summarisation

"Catch me up" on a long thread. Cheap, obvious, useful when joining a ticket
late. Small enough to add whenever the thread length starts to hurt.

---

## Scale

### pgvector, when a project gets big

Similarity is currently scored with a sequential scan inside one project —
`sum(a * b)` over a `real[]`, which measured **57ms across 2,167 tickets**. That
is fine, and it keeps the app running on stock Postgres: no extension, so CI,
a fresh clone and Neon all behave the same.

It stops being fine somewhere around **10,000 tickets in a single project**,
where the scan would pass ~250ms. At that point the answer is a `vector(384)`
column with an HNSW index, which Neon supports (pgvector 0.8.6) — and the
migration is mechanical, because the vectors are already stored and the query is
already isolated in one function.

Worth knowing: the limit is per *project*, not per workspace. A workspace of
100,000 tickets spread across 50 projects never reaches it.

### Caching

Deliberately not done. Benchmarked at 26,042 tickets: every dashboard query came
in under 5ms except `getTeamWorkload`, which was fixed by moving the aggregation
into the database rather than by caching it. Adding a cache now would buy
nothing and cost correctness.

---

## Considered and rejected

**AI-written ticket descriptions.** People distrust generated prose in a field
they are accountable for, and rewrite it anyway. The capture flow already covers
the case that matters — turning notes you *did* write into structure.

**A bigger chatbot.** The Copilot scores 100% across its evals. More tools would
widen the surface faster than they add value; the returns are in the push
features above.

**AI-guessed estimates** without history. Confident guessing, presented as a
number somebody plans around.

**Autonomous actions** — the Copilot acting without approval. The
propose-then-confirm step is the feature, not an obstacle to it. An agent that
silently edits tickets is one nobody can audit, and the audit log would record
the automation rather than a decision anybody made.
