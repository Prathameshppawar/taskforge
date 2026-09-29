# Integrations

How to set up each integration, what it needs, what it costs, which permissions
it asks for, how it behaves, and what to check when it does not work. Every
variable named here is described in [ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md).

Everything here runs on free tiers. Where a free tier has a ceiling or a paid plan
would be needed, it is said in that section.

## Contents

- [Costs at a glance](#costs-at-a-glance)
- [Who can configure what](#who-can-configure-what)
- [GitHub App](#github-app)
  - [Creating the app](#creating-the-app)
  - [Permissions it asks for](#permissions-it-asks-for)
  - [Optional permissions: Workflows and Administration](#optional-permissions-workflows-and-administration)
  - [Accepting new permissions on the installation](#accepting-new-permissions-on-the-installation)
  - [Webhooks and reconciliation](#webhooks-and-reconciliation)
  - [Linking repositories to projects](#linking-repositories-to-projects)
  - [Connecting your own GitHub account](#connecting-your-own-github-account)
  - [Tokens and caching](#tokens-and-caching)
  - [Pinning the app from the environment](#pinning-the-app-from-the-environment)
  - [GitHub troubleshooting](#github-troubleshooting)
- [Deployments and Vercel](#deployments-and-vercel)
- [Email out (SMTP)](#email-out-smtp)
- [Email in (IMAP)](#email-in-imap)
- [Microsoft Teams bot](#microsoft-teams-bot)
- [Outbound webhooks](#outbound-webhooks)
- [REST API v1 and MCP](#rest-api-v1-and-mcp)
- [Error ingest](#error-ingest)
- [Uptime monitors](#uptime-monitors)
- [Single sign-on](#single-sign-on)
  - [Keycloak](#keycloak)
  - [Google](#google)
  - [Microsoft Entra ID](#microsoft-entra-id)

---

## Costs at a glance

| Integration | Cost | Free-tier notes |
|---|---|---|
| GitHub App | Free | Apps and their API calls cost nothing |
| Deployments through GitHub | Free | GitHub Pages on a **private** repository needs a paid GitHub plan |
| Vercel rollback | Free | A Hobby account's token works |
| Email out and in | Free | Any SMTP/IMAP mailbox; Gmail with an app password works |
| Microsoft Teams bot | Free | Teams Developer Portal; no Azure subscription |
| Outbound webhooks, REST API, MCP | Free | Run on what already runs |
| Error ingest | Free | Any app can POST JSON; Sentry webhooks depend on your Sentry plan |
| Uptime monitors | Free | GitHub Actions minutes; see [the note on private repositories](#free-tier-minutes) |
| Single sign-on | Free | Keycloak is open source but needs its own server; Google and Entra ID need none |

---

## Who can configure what

| Action | Permission |
|---|---|
| Create or disconnect the GitHub App, set its webhook URL, Vercel, email in, Teams, outbound webhooks | **Manage integrations** (`integration:manage`), workspace-wide |
| AI engines and keys | `ai:manage` (Workspace → AI) |
| Link repositories to a project, GitHub automation switches, per-project email intake, error intake URL, monitors, linking a Teams channel, rollback | **Configure** the project (`project:manage-config`) |
| Press **Sync** on a project's repositories | `ticket:update` in that project |

`integration:manage` is workspace-wide on purpose: whoever holds it can see the
names of every repository the app can reach, including ones no project has been
given.

---

## GitHub App

Mention a ticket's key in a branch, pull request or commit and it appears on the
ticket; a new branch moves the ticket to In Progress, an open pull request to
Review, a merge to Done. The same app lets Fix with AI push a branch and open a
pull request, and reports CI and deployments.

**Needs:** a GitHub account or organisation you own, and **Manage integrations**
in TaskForge. No environment variables. **Costs:** nothing.

TaskForge uses a GitHub **App**, not a personal token. An app is installed on an
account with an explicit repository grant, acts through short-lived installation
tokens, and belongs to nobody, so nothing breaks when someone leaves.

### Creating the app

1. **Workspace → Integrations → GitHub.** Choose where the app should live: your
   personal account, or an organisation (you must be an owner of it; type its
   name).
2. TaskForge posts a manifest to GitHub (`/api/github/manifest`), which opens
   GitHub's new-app form pre-filled. The name is `TaskForge <org> <4 characters>`
   because app names are unique across GitHub; rename it if you like, then
   create it.
3. GitHub redirects to `/api/github/manifest/callback` with a one-time code.
   TaskForge exchanges it for the app's id, private key, webhook secret and
   OAuth client credentials and stores them sealed with `AUTH_SECRET`. No key
   passes through a browser or a clipboard.
4. You are sent straight on to installing the app. Pick **All repositories** or
   a selection.
5. GitHub returns you to `/api/github/setup`, which lists the installation's
   repositories. You land back on Integrations with them shown.

The manifest registers these URLs on the app, all on the origin you started
from:

| Setting on GitHub | Value |
|---|---|
| Homepage | `<site>` |
| Webhook URL | `<site>/api/github/webhook` if public, else `GITHUB_WEBHOOK_URL`, else a disabled placeholder |
| Setup URL (also called on updates) | `<site>/api/github/setup` |
| Callback URL (user authorisation) | `<site>/api/github/user/callback` |
| Visibility | Private: only the owning account can install it |

The flow is protected by a random `state` cookie that lasts 15 minutes. A code
that comes back without it is refused.

Create the app **from the deployment it will serve**. The URLs above are fixed at
creation; the webhook can be re-pointed later from TaskForge, the others only in
the app's settings on GitHub.

### Permissions it asks for

These are the repository permissions in `APP_PERMISSIONS`
(`src/features/github/manifest.ts`):

| Repository permission | Access | Why |
|---|---|---|
| Metadata | Read | Required by GitHub for every app |
| Contents | **Read and write** | Read code, branches and commits; Fix with AI pushes a branch |
| Pull requests | **Read and write** | Read pull requests; Fix with AI opens one |
| Checks | Read | CI state on pull requests |
| Deployments | Read | What shipped where (Vercel, Netlify and others report here) |
| Actions | Read | Failing CI logs, so a red pull request can be fixed from its own output |

Events it subscribes to: `create`, `delete`, `push`, `pull_request`,
`check_suite`, `deployment_status` and `repository`. `installation` and
`installation_repositories` are delivered to every app without being asked for.

No code path merges to or pushes to a default branch, and **Workflows is
deliberately not requested**, so by default nothing TaskForge writes can change
CI.

### Optional permissions: Workflows and Administration

Two features need more than the manifest grants. Add them by hand in the app's
settings on GitHub (**Settings → Developer settings → GitHub Apps → your app →
Permissions & events**; the project settings link straight to
`https://github.com/settings/apps/<slug>/permissions`).

**Workflows: Read and write.** Needed only when the Coder writes files in
`.github/workflows/`, for tickets like "set up CI" or "deploy on merge". It is
off per project until someone with Configure turns on **Let Fix with AI write CI
workflows** in project settings. With that switch on, every workflow is checked
before it is committed (no secrets beyond `GITHUB_TOKEN`, no
`pull_request_target`, third-party actions pinned, `.yml`/`.yaml` directly in
`.github/workflows/`) and opens as a draft pull request. Without the GitHub
permission, GitHub refuses the write and the run reports:

> GitHub refused to write a workflow file (.github/workflows). Workflow files need
> their own permission: in the TaskForge app's settings on GitHub, set Repository
> permissions → Workflows to "Read and write", then accept the new permission on
> the installation.

**Administration: Read and write.** Needed only to create a repository from
TaskForge ("Start a new repository" from a ticket). See
[Connecting your own GitHub account](#connecting-your-own-github-account).

### Accepting new permissions on the installation

Changing an app's permissions does not take effect until each installation
accepts them. After saving the new permission on the app:

1. The owner of the account the app is installed on opens **Settings →
   Applications → Installed GitHub Apps** (for an organisation, the
   organisation's settings), then **Configure** on the TaskForge app.
2. GitHub shows the requested change. **Accept new permissions.**

Because the manifest sets `setup_on_update`, GitHub then calls
`/api/github/setup` again and TaskForge re-syncs the installation. Until the
change is accepted, writes that need it fail with GitHub's 403, which TaskForge
reports as a permission problem.

### Webhooks and reconciliation

Two paths feed the same idempotent upsert, so running them together, twice or
out of order gives the same result:

- **Webhooks** at `/api/github/webhook`. Each delivery's `X-Hub-Signature-256`
  is verified in constant time over the raw body before the JSON is parsed; a bad
  signature gets `401`. Handled events answer `200`, others `202` (acknowledged
  and ignored), and a failure `500`, so it shows red in GitHub's delivery log and
  can be redelivered from there.
- **Reconciliation** asks GitHub for a linked repository's current state: the 50
  most recently updated pull requests, the first 100 branches and the last 50
  commits on the default branch. It runs when a repository is linked, when
  someone presses **Sync** on a project, and on the daily cron
  (`/api/cron/recurring`, up to 25 linked repositories per run, skipped when
  GitHub is not connected).

Reconciliation is what makes the integration work **without a public URL**:
locally, without a tunnel, Sync does the webhook's job.

**Changing the webhook address.** Workspace → Integrations → **Live updates**.
Paste a public `https://` base URL (or the full `/api/github/webhook` path) and
TaskForge updates the app's webhook through GitHub's API. `localhost`,
`127.0.0.1`, `0.0.0.0`, `*.localhost`, `*.invalid` and plain `http://` are
refused. Clearing it points the webhook at a disabled placeholder. In
development, run `ngrok http 3000` and paste its https address, or set
`GITHUB_WEBHOOK_URL` before creating the app.

### Linking repositories to projects

Project → Settings → **Repositories** (needs Configure). Projects and
repositories are many-to-many; each link can carry a role such as *API* or
*Tablet app*. Only repositories the installation grants are offered. Linking
triggers a reconciliation.

A key in git text counts only if its project code belongs to a project linked to
that repository, so `utf-8` in a branch name does not become ticket UTF-8.
Unlinking, or the app losing access, keeps the history on tickets; a repository
that dropped out of the grant is shown as *app lost access*, not deleted.

Per-project switches on the same panel:

| Switch | Default | What it does |
|---|---|---|
| Move tickets from GitHub | On | Branch → In Progress, open pull request → Review, merge → Done. Only forward, never touching Done or Cancelled, and only when something changed |
| Let Fix with AI write CI workflows | Off | See [Workflows](#optional-permissions-workflows-and-administration) |
| Fix failing CI on AI pull requests automatically | Off | When checks on a Coder pull request fail, it reads the failure and pushes a fix, at most twice per pull request |
| Open AI pull requests as drafts until CI passes | Off | In repositories with CI; marked ready when every check is green. A workflow change always stays a draft |
| Auto-merge small, green, reviewed AI pull requests | Off | Only when the Coder opened it, it is not a draft, CI passed, the Reviewer found nothing, it touches no workflow, it is within the size limit (default 40 lines) and the ticket kind is allowed (default Task and Enhancement). Asks for confirmation |

### Connecting your own GitHub account

An app cannot create a repository under a personal account; only that account
can. So "Start a new repository" uses a **user access token**, issued through the
same app's OAuth flow, acting as the person and limited to what the app may do.

1. The app needs **Administration: Read and write** (add it, then accept it on
   the installation) and must list `<site>/api/github/user/callback` as a
   callback URL. Apps created by the manifest already list it.
2. Each person opens **Settings → GitHub → Connect GitHub**. GitHub asks them to
   authorise the app and returns to `/api/github/user/callback` (protected by a
   10-minute `state` cookie).
3. The token is stored sealed. GitHub issues these to expire after eight hours,
   with a refresh token valid for six months; TaskForge refreshes the token when
   it is within five minutes of expiry. After six months without use, the person
   reconnects.

The app must also be installed on the account or organisation the repository is
created under. If that installation covers only selected repositories, the new
one is added to it so TaskForge can see it straight away.

If the app is [pinned from the environment](#pinning-the-app-from-the-environment),
set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as well, because a pinned app
has no stored OAuth credentials.

### Tokens and caching

- **App JWT**: signed RS256 with the app's private key, backdated a minute and
  valid nine minutes (GitHub allows ten), used only to talk about the app and its
  installations.
- **Installation token**: exchanged for with the JWT, **valid one hour**, used on
  the repositories the installation grants. Cached per server process until five
  minutes before expiry. On serverless the cache lives as long as a warm
  function, which is enough to avoid repeating the exchange within one webhook or
  sweep.
- **User token**: see above. Eight hours, refreshed automatically.

### Pinning the app from the environment

For a production deployment that should not depend on database state, set
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` (and
optionally `GITHUB_APP_SLUG`). With all three present they win over the stored
app. A key can then be rotated by redeploying.

### GitHub troubleshooting

| Symptom | Cause and fix |
|---|---|
| "That link did not start here, so it was refused." | The `state` cookie was missing or different (another browser, or more than 15 minutes). Start again from the button |
| "GitHub created the app but would not hand over its credentials" | The one-time code expired or was used. Create the app again |
| "The app was installed, but listing its repositories failed. Press Refresh." | A transient GitHub error during setup. Press **Refresh** on Integrations |
| "The stored GitHub App could not be unsealed" | `AUTH_SECRET` changed. **Disconnect** the app and create a new one; delete the old one on GitHub |
| Tickets do not move after a merge | Webhook not reaching TaskForge (check the app's **Advanced → Recent deliveries** on GitHub), repository not linked to the project, the key's project not linked to that repository, or **Move tickets from GitHub** off. Press **Sync** to catch up |
| Webhook deliveries show `401` | The webhook secret does not match. Usually an env-pinned `GITHUB_WEBHOOK_SECRET` that differs from the app's |
| Webhook deliveries show `503` | No GitHub App is configured on that deployment |
| "GitHub refused the write … Contents and Pull requests" | The installation has not accepted Contents and Pull requests write, or the repository is not in its grant |
| "GitHub refused to write a workflow file" | Add **Workflows: Read and write** and accept it on the installation |
| "GitHub refused (…). The TaskForge app needs the Administration permission" when creating a repository | Add **Administration: Read and write** and accept it |
| "Connect your GitHub account first (Settings → GitHub)." | The person has not connected, or their refresh token has expired |
| "The TaskForge app is not installed on <owner>" | Install the app on that account or organisation |

---

## Deployments and Vercel

### Deployments, seen through GitHub

TaskForge reads deployments from **GitHub's Deployments API** (the Deployments
read permission and the `deployment_status` event), not from any one host's, so
Vercel, Netlify, Render and plain workflows all work without extra setup.

- A **preview** deployment attaches its link to the tickets on that branch.
- A successful **production** deployment marks every ticket it shipped as live
  and, if the project has **Move tickets from GitHub** on, moves a merged ticket
  to Done.
- A deployment counts as production when the provider says so
  (`production_environment`), otherwise when its environment is named `prod` or
  `production`.

These also feed the DORA metrics on each project's Insights and the "suspect
changes" on error tickets.

**GitHub Pages:** Pages deployments are reported through the same API, but
publishing Pages from a **private** repository needs a paid GitHub plan. On
GitHub Free, Pages works only for public repositories.

### Vercel rollback

Seeing deployments needs nothing from Vercel. A Vercel token adds one thing: a
**Roll back** button on the live production deployment shown on a ticket, which
uses Vercel's Instant Rollback to re-point production at the previous successful
production build without rebuilding.

1. Create a token at <https://vercel.com/account/settings/tokens>.
2. **Workspace → Integrations → Vercel.** Paste the token, and the **team id**
   (`team_…`) if the project belongs to a team. **Connect.** TaskForge checks the
   token against Vercel before keeping it; a rejected token is not saved.
3. The token is stored sealed; only its last four characters are shown.

Rolling back needs **Configure** on the project and asks for confirmation. It
refuses when the deployment is not production, when there is no earlier
successful production deployment, or when the deployment was not made by
Vercel. Each ticket in the rolled-back deployment gets a comment saying so.
**Cost:** free on Hobby.

---

## Email out (SMTP)

Welcome emails for new accounts, notifications (assigned, mentioned, replied to,
blocked), urgent-ticket alerts to managers, the Monday manager digest, the daily
digest, AI usage reports and budget alerts, and replies to email in.

**Needs:** `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`; optionally `EMAIL_PORT`
(default 587) and `EMAIL_FROM`. **Costs:** nothing with Gmail or any mailbox you
already have.

**Gmail:**

```bash
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT="587"
EMAIL_USER="you@gmail.com"
EMAIL_PASS="<16-character app password>"
EMAIL_FROM="TaskForge <you@gmail.com>"
```

Create the app password under Google Account → Security → App passwords (needs
2-Step Verification). Never use the account password.

**Behaviour** (`src/infrastructure/email/mailer.ts`):

- Port 465 uses implicit TLS; 587 upgrades with STARTTLS.
- A message to one person goes in **To**. A message to several (a report to
  managers) is sent once, addressed to the From address, with recipients in
  **Bcc** so they do not see each other.
- Every message carries `Auto-Submitted: auto-generated`, so other systems'
  auto-replies do not answer it, and TaskForge ignores the ones that do.
- Emails about a ticket carry `[KEY-12]` in the subject and, when email in is on
  for that project, a Reply-To of the ticket's own address.
- Without the three variables, sending is skipped quietly and everything else
  carries on.

Anyone can turn notification emails off in **Settings → Notifications**.

---

## Email in (IMAP)

People email a project and get a ticket; they reply to a TaskForge email and it
becomes a comment. It reads the mailbox TaskForge already sends from.

**Needs:** email out configured, `EMAIL_USER` a full address, and IMAP reachable
at `IMAP_HOST` (default: the SMTP host with `smtp.` → `imap.`) on `IMAP_PORT`
(default 993). The five-minute cron (`/api/cron/monitors`) must be running.
**Costs:** nothing.

### Setup

1. **Workspace → Integrations → Email in.** Turn on **Read the mailbox**.
   Optionally leave **Structure with the Copilot** on (the default).
2. In each project that should take email: Project → Settings → **Tickets by
   email** → **Take tickets by email**. The settings show the project's address.
3. **Check now** on the Integrations card polls straight away and shows the
   result.

### Addresses (plus addressing)

With `EMAIL_USER="team@gmail.com"`:

| Address | Becomes |
|---|---|
| `team+demo@gmail.com` | A new ticket in project DEMO |
| `team+demo-12@gmail.com` | A comment on DEMO-12 |
| `[DEMO-12]` in the subject, sent to the mailbox | A comment on DEMO-12, for mail clients that drop the plus address |
| `team@gmail.com` with no plus part and no key | Ignored |

For Gmail addresses, dots in the local part are ignored when matching, as Gmail
does.

### What is read and marked read

The mailbox is a real inbox, so the poller is careful:

- It lists **unread** mail from the **last four days** (at most the latest 300)
  by envelope only, and picks out what is addressed (To or Cc) to a project or
  ticket plus address.
- It fetches and handles at most **15** of those per run, and marks **only
  those** as read. Nothing else in the inbox is opened or changed.
- Every message is recorded once by Message-ID before anything is done, so two
  polls at once cannot file it twice. The record, with what became of it
  (created, commented, rejected and why, ignored), is listed on the Integrations
  card, with the last poll time and error.

### Who may act

- The sender must be **authenticated** by the receiving server's
  `Authentication-Results`: DMARC passed for the From domain, or DKIM or SPF
  passed for the sender's own domain (a subdomain counts; another domain does
  not). The exception is mail the mailbox owner sends to their own plus address,
  which Gmail labels Sent and which carries no verdict.
- The From address must belong to an **active, human** TaskForge account.
- The message then runs the same Server Actions the UI does, **as that person**,
  so permissions, audit and notifications are theirs. Nobody can do by email what
  they could not do by hand.
- Out-of-office replies, bounces and mailing lists (`Auto-Submitted`,
  `Precedence: bulk/list/junk/auto_reply`, `List-Id`, `List-Unsubscribe`,
  `mailer-daemon@`, `no-reply@` and similar) are ignored.

A sender with no account, or writing to a project that does not take email, gets
a short reply saying why.

### What an email becomes

- **New ticket:** with **Structure with the Copilot** on and a Copilot engine
  connected, the engine writes a title, a Markdown description, a type and
  priority from the project's own lists, and acceptance criteria. The original
  email is always kept, quoted, below. Otherwise the subject (without `Re:`,
  `Fwd:` and ticket tags) is the title and the text the description; `- [ ]`
  lines become acceptance criteria. Attachments are saved within the usual
  limits. The sender gets a reply with the key, a link, and a **Reply-To** of the
  ticket's address, so replying adds to it.
- **Reply:** quoted history and signatures are removed (conservatively) and the
  rest becomes a comment ending "— by email". A forwarded email keeps everything.
- Replies are threaded with `In-Reply-To` and `References`.

### Troubleshooting

| Symptom | Cause |
|---|---|
| "Email is not configured for this workspace." in project settings | SMTP incomplete, or no IMAP host derivable |
| "Email in is off for the workspace" | Turn on **Read the mailbox** on Integrations |
| Nothing is read | The five-minute cron is not running (see [Uptime monitors](#uptime-monitors)), or the mail is already marked read, or older than four days |
| Rejected: "sender not authenticated" | The sender's domain has no passing DMARC, DKIM or SPF, or it was forwarded in a way that broke them |
| Rejected: "no account uses this address" | Add that email to the person's account |
| Last error shows an IMAP login failure | Wrong app password, or IMAP not allowed on the account |

---

## Microsoft Teams bot

People describe what they need in a chat with the bot or in a project's channel.
It asks what is missing, keeps a draft ticket everyone in the thread can shape,
and files it when someone presses **Create ticket**, as that person with their
permissions. A linked channel also hears about the project's new tickets.

**Needs:** a Microsoft 365 work account that can upload custom apps, and **Manage
integrations**. Uses the Copilot's engine for the conversation. **Costs:**
nothing; bot management in the Teams Developer Portal needs no Azure
subscription.

### Setup

1. **Workspace → Integrations → Microsoft Teams.** Copy the messaging endpoint
   shown there: `<site>/api/msteams/messages`.
2. In the [Teams Developer Portal](https://dev.teams.microsoft.com/bots), open
   **Tools → Bot management**, create a bot, and set its endpoint to that address.
3. Under **Client secrets**, add one.
4. Back in TaskForge, paste the **Bot (app) ID**, the **client secret** and your
   Microsoft 365 **tenant ID** (Directory ID; both IDs are GUIDs). **Connect.**
   TaskForge asks Microsoft for a token with those credentials before saving, so
   wrong ones are caught at once. The secret is stored sealed.
5. **App package** downloads a ready Teams app (manifest and icons, zipped, with
   this bot's id and your domain). In Teams: **Apps → Manage your apps → Upload an
   app**.
6. Chat with the bot, or add it to a team and write `@TaskForge link CODE` in a
   channel.

**Single-tenant.** Microsoft now creates single-tenant bots, so the tenant id
matters: tokens are requested from
`https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` with scope
`https://api.botframework.com/.default`. Left empty, the multi-tenant
`botframework.com` endpoint is used. Tokens are cached until five minutes before
expiry.

### Commands

| Command | Where | Does | Needs |
|---|---|---|---|
| (just write) | Chat or channel | Brainstorm: the bot asks questions and updates the draft | |
| `help` | Anywhere | What it can do | |
| `use CODE` | Chat | File into project CODE from this chat | Create tickets in CODE |
| `link CODE` | Channel | Tie the channel to CODE; tickets shaped there go to CODE, and CODE's new tickets are posted here | Configure CODE |
| `unlink`, `mute`, `unmute` | Linked channel | Remove the link, or stop/restart new-ticket posts | Configure the project |
| `DEMO-12` | Anywhere | Show a ticket | See the ticket |
| `create` (or **Create ticket**) | Anywhere | File the draft | Create tickets |
| `discard` | Anywhere | Throw the draft away | |

### Identity and security

- A Teams account is matched to a TaskForge account by email (or user principal
  name) the first time the person writes, and remembered. Only work accounts are
  accepted. Someone with no matching active account is told to ask for one.
- Every incoming request's JWT is verified against Bot Framework's published keys
  (RS256 only, a known key id, refetched once on an unknown one, the key endorsed
  for the channel), then the claims: our app id as audience, Bot Framework as
  issuer, five minutes of clock skew, and a `serviceUrl` claim matching the
  activity's. Anything else gets `401`.
- Replies go only to Microsoft hosts (`botframework.com`, `trafficmanager.net`,
  `teams.microsoft.com`, `botframework.azure.us`, over https), so a forged
  activity cannot collect the bot's token.
- The request is acknowledged at once and the reply posted afterwards, because
  Teams expects an answer within seconds.

### Troubleshooting

| Symptom | Cause |
|---|---|
| "Microsoft refused the bot's credentials" on Connect | Wrong app id, secret, or tenant id; or the secret has expired |
| The bot never answers | Endpoint in the Developer Portal is not `<site>/api/msteams/messages`, or not public |
| "I don't know who you are in TaskForge yet" | No active account uses the person's Teams email; add it |
| "Linking is for channels" | `link` was used in a chat; use `use CODE` there |
| Cannot upload the app package | The tenant does not allow custom app upload; an administrator must allow it |

For local testing without a tenant, see the development-only
`MSTEAMS_TEST_CONNECTOR` and `MSTEAMS_TEST_JWKS` in
[ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md#11-microsoft-teams-test-hooks-development-only).

---

## Outbound webhooks

Tell other systems when tickets change. **Workspace → Integrations → API and
webhooks → Add a webhook.** Give it a name, a URL, the events, and one project or
all projects. The **signing secret** (`whsec_…`) is shown **once**; copy it then.
It is stored sealed. **Costs:** nothing.

### Events

| Event | When | `data` |
|---|---|---|
| `ticket.created` | A ticket is created | `ticket` (`key`, `title`, `project`, `url`), `status` |
| `ticket.status_changed` | A ticket changes status | `ticket`, `from` and `to` (status categories: `BACKLOG`, `TODO`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`, `CANCELLED`), `changedAt` |
| `ticket.completed` | A ticket enters Done (sent alongside `status_changed`) | `ticket`, `completedAt` |
| `comment.created` | A comment is added | `ticket` (`key`, `title`, `url`), `author` (`name`, `username`), `body` (first 5,000 characters), `createdAt` |
| `ping` | The **Test** button | `message` |

Events are read from the histories the database already keeps (status changes
and comments), so no write path can forget to emit one. A new webhook does not
replay history.

### The request

```
POST <your URL>
Content-Type: application/json
User-Agent: TaskForge-Webhooks/1.0
X-TaskForge-Event: ticket.created
X-TaskForge-Signature: sha256=<hex HMAC-SHA256 of the raw body>

{"event":"ticket.created","deliveredAt":"2026-09-29T10:00:00.000Z","data":{...}}
```

Any 2xx is success. Redirects are **not** followed (a 3xx counts as a failure),
and the request times out after 10 seconds.

### Verifying the signature

Compute HMAC-SHA256 of the **raw** request body with the signing secret, prefix
`sha256=`, and compare in constant time. Re-serialising parsed JSON changes the
bytes and the signature will not match.

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'

const SECRET = process.env.TASKFORGE_WEBHOOK_SECRET // the whsec_… value

function verify(rawBody, header) {
  const expected = Buffer.from(`sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`)
  const actual = Buffer.from(header ?? '')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const app = express()
app.post('/taskforge', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verify(req.body, req.get('X-TaskForge-Signature'))) return res.sendStatus(401)
  const { event, data } = JSON.parse(req.body.toString('utf8'))
  // handle event…
  res.sendStatus(204)
})
```

### Delivery, retries and backoff

- The five-minute cron (`/api/cron/monitors`) reads new events and queues one
  delivery per event per subscribed webhook on the Postgres job queue, then
  drains the queue. Expect delivery within about five minutes.
- A failed delivery (non-2xx, timeout, refused address) is retried up to **six
  attempts** in total, waiting **1 min, 5 min, 30 min, 2 h, then 6 h** between
  them: about eight and a half hours. Retries run when the queue is next drained,
  so each wait is rounded up to the next cron run.
- Each event is queued once per webhook, but a receiver should still treat
  deliveries as at-least-once and de-duplicate on its own terms.
- The card shows each webhook's last status and error. Failed jobs can be retried
  from the Integrations page (**Retry failed**).

### Private addresses are refused

A webhook makes the server fetch a URL someone typed, so only public `http(s)`
hosts are allowed, checked when saved and again, by DNS, on every delivery:
`localhost`, `*.local`, `*.internal`, loopback, private ranges (10/8, 172.16/12,
192.168/16), link-local (including the cloud metadata address 169.254.169.254),
carrier-grade NAT, IPv6 unique-local and link-local, and IPv4-mapped forms are
refused. Credentials in the URL are refused too.

---

## REST API v1 and MCP

Both authenticate with a **personal access token** (Settings → Access tokens),
sent as `Authorization: Bearer <token>`. The token resolves to the same actor as
a browser session, so every call has exactly that person's permissions and goes
through the same Server Actions and audit.

```
GET    /api/v1/projects
GET    /api/v1/tickets?project=DEMO&q=checkout&category=DONE&assignee=me
POST   /api/v1/tickets
GET    /api/v1/tickets/DEMO-12
PATCH  /api/v1/tickets/DEMO-12
POST   /api/v1/tickets/DEMO-12/comments
```

- REST API: see [API.md](API.md) and the README's "Integrating" section.
- MCP server (Claude or any MCP client): see [MCP.md](MCP.md). It runs locally
  with `TASKFORGE_URL`, `TASKFORGE_TOKEN` and optionally `TASKFORGE_PROJECT`.

---

## Error ingest

Production errors become tickets, filed by the Triage agent with the stack, a
count, and the changes most likely to have caused them.

1. Project → Settings → **Production errors** (needs Configure) → generate the URL:
   `<site>/api/ingest/errors/tfe_…`. It is shown **once**; only its hash is kept.
   Generating again rotates it and the old URL stops working.
2. Send errors to it:
   - **Sentry:** Settings → Integrations → Webhooks (or an internal
     integration), paste the URL as the webhook URL, and add it to an issue alert
     rule. Sentry's test ping is acknowledged.
   - **Anything else:** POST JSON with at least a `message`:

     ```bash
     curl -X POST -H 'Content-Type: application/json' \
       -d '{"message":"TypeError: x is undefined","stack":"…","environment":"production","release":"abc1234"}' \
       <url>
     ```

     Also accepted: `title`, `level` (`fatal`, `error`, `warning`, `info`), `url`,
     `commit`, `fingerprint`.

**Behaviour.** Errors are grouped by a fingerprint that masks what varies
(numbers, ids, emails, quoted values, the top frame's line number), or by the
sender's own fingerprint. A new group opens a Production ticket; repeats raise
the count, with a comment at 10, 100, 1,000 and 10,000; an error that returns
after its ticket was closed reopens it as a regression. At most **20 new tickets
per project per hour**, so a storm does not bury the board.

| Response | Meaning |
|---|---|
| `202` | Accepted |
| `404` | Unknown or malformed secret (the same answer for both) |
| `400` | Not JSON |
| `413` | Body over 256 KB |
| `422` | Not a Sentry payload and no `message` |

**Costs:** nothing on TaskForge's side. Whether Sentry's webhook and alert features are available depends on your Sentry plan; a plain JSON POST from your own error handler needs no service at all.

---

## Uptime monitors

Project → Settings → **Uptime monitors** (needs Configure). Each monitor has a URL, an
expected status (default 200), optional text the page must contain, and an
interval of 5 to 1,440 minutes (default 5). Two failures in a row open one
incident ticket per outage; recovery is posted to it with how long it was down.
Checks time out after 10 seconds, do not follow redirects, and are kept for seven
days. The same public-address rules as [webhooks](#private-addresses-are-refused)
apply, re-resolved on every check.

### The GitHub Actions schedule

Vercel Cron runs at most once a day on the Hobby plan, so
`.github/workflows/uptime.yml` calls TaskForge every five minutes instead:

```yaml
on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:
# …
curl --fail-with-body --silent --show-error --max-time 90 \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$TASKFORGE_URL/api/cron/monitors"
```

Add two **repository secrets** (GitHub → repository → Settings → Secrets and
variables → Actions):

| Secret | Value |
|---|---|
| `TASKFORGE_URL` | The production base URL, such as `https://taskforge.example.com` |
| `CRON_SECRET` | The same value as the deployment's `CRON_SECRET` |

Without them the workflow exits successfully and does nothing. Run it by hand
from the Actions tab (**Run workflow**) to test. The same endpoint also runs SLA
alerts, [email in](#email-in-imap), the [outbound webhook](#outbound-webhooks)
sweep and the job queue, so those depend on this workflow too. Only monitors
whose interval has elapsed are checked, so calling it more often is harmless.

<a id="free-tier-minutes"></a>
**Free-tier minutes.** GitHub Actions is free without limit on public
repositories. On a **private** repository, GitHub Free includes 2,000 minutes a
month and bills each job rounded up to the minute; a job every five minutes is
about 8,640 minutes a month, well over that allowance. For a private repository,
either run the schedule from a public repository (it only needs the two secrets),
or lengthen the schedule and accept less frequent checks, email polling and
webhook delivery.
TaskForge's own repository is public, so its schedule costs nothing.

**Late runs.** GitHub treats schedules as best effort. In practice a
`*/5 * * * *` workflow can run hours apart when GitHub is busy — observed on this
project: 23:53, 02:47, 09:06. Uptime checks, SLA alerts, email in and webhook
deliveries all ride this cron, so they slow down with it (work queued inside a
request still starts at once, because the request drains the queue itself). For
a dependable five minutes at no cost, point a free external scheduler — such as
cron-job.org, which runs every minute on its free plan — at
`GET <site>/api/cron/monitors` with the header
`Authorization: Bearer <CRON_SECRET>`, and keep the GitHub workflow as a backup.
Calling it more often is harmless: only monitors whose interval has elapsed are
checked, and every other step is idempotent.

| Symptom | Cause |
|---|---|
| Workflow log says "TASKFORGE_URL or CRON_SECRET is not set" | Add the repository secrets |
| Workflow fails with `401` | The repository's `CRON_SECRET` differs from the deployment's |
| Workflow fails with `503` | `CRON_SECRET` is not set on the deployment |
| Runs arrive late or skip | GitHub delays scheduled workflows under load — use an external scheduler as well (see above) |

---

## Single sign-on

Optional, configured by environment only. Each button appears on the sign-in page
when its variables are set. **No provider creates accounts**: a sign-in is
accepted only when the provider has verified the email and it matches an
existing, active, human TaskForge account (case-insensitive). Accounts stay
provisioned by an administrator. A single sign-on never has a temporary password
to replace.

| Sign-in page message | Cause |
|---|---|
| "That account is not in this workspace. Ask your administrator to add you with the same email." | No account uses that email (or it is an agent account) |
| "Your provider has not verified that email address, so it cannot be used to sign in." | The provider did not mark the email verified |
| "Your account has been deactivated." | The account exists but is inactive |

**Costs:** Keycloak is free and open source but needs a server of its own. Google
and Microsoft Entra ID sign-in are free.

### Keycloak

1. In your Keycloak, choose (or create) the **realm** your people are in.
2. Create a **client**: OpenID Connect, **client authentication on**
   (confidential), standard flow enabled.
3. Set the **valid redirect URI** to `<site>/api/auth/callback/keycloak`, such as
   `https://taskforge.example.com/api/auth/callback/keycloak`.
4. Copy the client secret from the client's **Credentials** tab.
5. Set:

   ```bash
   KEYCLOAK_ISSUER="https://auth.example.com/realms/yourrealm"
   KEYCLOAK_CLIENT_ID="taskforge"
   KEYCLOAK_CLIENT_SECRET="…"
   KEYCLOAK_LABEL="Company login"   # optional button text; default "Keycloak"
   ```

6. Make sure each user's email in Keycloak is **verified** (`email_verified`
   true) and matches their TaskForge account's email.

Keycloak can itself broker Google, Microsoft and LDAP, so an organisation that
already runs one can put everything behind it.

### Google

1. Create an OAuth client (web application) in Google Cloud Console.
2. Authorised redirect URI: `<site>/api/auth/callback/google`.
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

Google must report the email as verified.

### Microsoft Entra ID

1. Register an application in the Entra admin centre, with a web redirect URI of
   `<site>/api/auth/callback/microsoft-entra-id`, and add a client secret.
2. Set:

   ```bash
   AUTH_MICROSOFT_ENTRA_ID_ID="<application (client) id>"
   AUTH_MICROSOFT_ENTRA_ID_SECRET="<client secret value>"
   AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant-id>/v2.0"
   ```

The tenant's own issuer keeps sign-in to your organisation's accounts. Entra ID
addresses are treated as verified by the organisation; the email is taken from
`email`, or `preferred_username` when that is absent.
