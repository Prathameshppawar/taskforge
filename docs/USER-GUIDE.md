# TaskForge user guide

How to do things in TaskForge, organised by task. It is written for the people
who use the product: team members, project managers, workspace administrators
and clients who sign in to the portal.

Click paths are written as **Place → Place → Control**. Project settings is one
long page divided into sections, so **Project → Settings → Flow** means "open
the project's Settings tab and scroll to the section headed Flow".

What you can see and change depends on your role and your role in each project.
If a button described here is missing, you probably do not hold the permission
for it. [Roles and permissions](#roles-and-permissions) explains how that works.

## Contents

1. [Getting started](#1-getting-started)
   - [Signing in](#signing-in)
   - [Forced password change](#forced-password-change)
   - [Finding your way around](#finding-your-way-around)
   - [Keyboard shortcuts](#keyboard-shortcuts)
   - [The command palette](#the-command-palette)
   - [Notifications and the inbox](#notifications-and-the-inbox)
   - [Your profile and preferences](#your-profile-and-preferences)
   - [Dark mode](#dark-mode)
   - [Installing TaskForge as an app](#installing-taskforge-as-an-app)
2. [Projects](#2-projects)
   - [Creating a project from a template](#creating-a-project-from-a-template)
   - [Members and teams](#members-and-teams)
   - [The project tabs](#the-project-tabs)
   - [Project settings](#project-settings)
   - [Importing from Jira, Trello or a spreadsheet](#importing-from-jira-trello-or-a-spreadsheet)
3. [Tickets](#3-tickets)
   - [Creating a ticket](#creating-a-ticket)
   - [The ticket page](#the-ticket-page)
   - [Writing in Markdown](#writing-in-markdown)
   - [Acceptance criteria](#acceptance-criteria)
   - [Child tickets](#child-tickets)
   - [Linked tickets, watchers, attachments and resources](#linked-tickets-watchers-attachments-and-resources)
   - [Comments and @mentions](#comments-and-mentions)
   - [Status rules](#status-rules)
   - [Bulk edit and Undo](#bulk-edit-and-undo)
   - [Filters, saved filter sets and Describe a view](#filters-saved-filter-sets-and-describe-a-view)
   - [Exporting](#exporting)
   - [Recurring tickets](#recurring-tickets)
4. [Flow](#4-flow)
5. [Planning](#5-planning)
6. [Time](#6-time)
7. [Working with GitHub from a ticket](#7-working-with-github-from-a-ticket)
8. [AI helpers](#8-ai-helpers)
9. [Email in and the Microsoft Teams bot](#9-email-in-and-the-microsoft-teams-bot)
10. [The client portal](#10-the-client-portal)
11. [Administration](#11-administration)
12. [Troubleshooting and FAQ](#12-troubleshooting-and-faq)

---

## 1. Getting started

### Signing in

Accounts are created by an administrator; there is no self sign-up and no
"forgot password" link. When your account is created you receive a welcome
email with your **username**, a temporary password and a sign-in link.

1. Open the sign-in page.
2. Enter your **Username** (not your email address) and **Password**. The eye
   icon in the password field shows what you typed.
3. Press **Sign in**.

If your organisation has single sign-on set up, buttons such as **Continue with
Keycloak**, **Continue with Google** or **Continue with Microsoft** appear above
the username form. Single sign-on only admits people who already have a
TaskForge account with the same, verified, email address. It never creates an
account. If it turns you away you will see one of these:

| Message | What it means |
|---|---|
| That account is not in this workspace. Ask your administrator to add you with the same email. | No TaskForge account uses the email your provider returned. |
| Your provider has not verified that email address, so it cannot be used to sign in. | Verify the address with your provider, or use your username and password. |
| Your account has been deactivated. | An administrator has switched your account off. |

After signing in, staff land on the **Dashboard**. Clients land in the
[client portal](#10-the-client-portal).

### Forced password change

If your account was created or reset with **Require a password change** on
(the default), the temporary password works for one sign-in only. You are taken
straight to **Settings → Security** with the notice *A password change is
required*, and every other page is unavailable until you choose a new one.

Enter the **Current password** (the temporary one), a **New password** and
**Confirm new password**, then save. You stay signed in on the device you used.

You can change your password at any time the same way: **your avatar (top
right) → Change password**.

### Finding your way around

The **sidebar** on the left holds:

| Entry | What it is |
|---|---|
| Dashboard | Your workspace at a glance. |
| My Tickets | Everything assigned to you, across every project. |
| Inbox | Your notifications, in full. |
| Timesheet | Your logged time, by ticket and day. |
| Projects | Every project you can see, and the **+** to create one (if you may). Your projects are listed underneath. |
| Activity | Everything that has happened across the projects you can see. |
| Workspace | Administration. Only shown if you hold at least one administrative permission. |
| Settings | At the foot of the sidebar: your own profile, notifications, security, GitHub connection and access tokens. |

The **header** holds, from left to right: a running timer (when you have one),
**Search ⌘K**, the **Capture** wand and **Copilot** sparkle (both only when an
AI engine is connected), the notification bell, the theme switch and your
avatar menu (**Profile**, **Change password**, **Access tokens**, **Sign out**).

On a phone the sidebar folds into a menu button.

### Keyboard shortcuts

| Keys | Does |
|---|---|
| `⌘K` / `Ctrl+K` | Open or close the command palette. |
| `?` | Open the command palette. |
| `⌘J` / `Ctrl+J` | Open or close the Copilot. |
| `G` then `D` | Go to Dashboard. |
| `G` then `T` | Go to My Tickets. |
| `G` then `P` | Go to Projects. |
| `G` then `A` | Go to Activity. |
| `G` then `S` | Go to Settings. |
| `⌘↵` | Send a comment or save in a Markdown editor. |
| `⌘B`, `⌘I`, `⌘K` | Bold, italic and link inside a Markdown editor. |
| `Escape` | Close the open menu or panel. |

The `G` chords must be typed within about a second of each other. Plain-letter
shortcuts are ignored while you are typing in a field, so a `g` in a comment is
just a `g`.

### The command palette

Press `⌘K`, or click **Search** in the header.

- **Type to search** tickets and projects. Search is ranked full-text, and a
  ticket key such as `DEMO-12` finds that ticket directly.
- **Press `→` on a highlighted ticket** for its actions: **Change status**,
  **Assign to** (or **Unassigned**) and **Open DEMO-12**. `←` on an empty
  filter, or `Escape`, goes back. If you can only view the project, the palette
  says *You have read-only access to this project.*
- **With nothing typed**, the palette lists commands:
  - *Create*: **New ticket** (opens the new-ticket dialog on the current
    project's board, or sends you to Projects if you are not in one),
    **New project**, **Ask the Copilot**, **Capture notes as tickets**.
  - *Go to*: Dashboard, My Tickets, Projects, Activity, Workspace, Settings.
  - *Appearance*: Light or Dark.

### Notifications and the inbox

You are notified when someone assigns you a ticket (including when they create
it assigned to you), @mentions you, replies to your comment, or blocks a ticket
you follow.

- **The bell** in the header shows the unread count. Open it to see recent
  notifications; clicking one opens the ticket and marks it read. **Mark all
  read** clears the count, and the speaker icon mutes or unmutes the chime.
- **Inbox** in the sidebar lists every notification.
- **The chime** plays only when your unread count goes up, not on every page
  load. Muting belongs to your account, so it follows you to every browser.

### Your profile and preferences

**Settings** (the gear at the foot of the sidebar) has these pages:

| Page | What you can do |
|---|---|
| Profile | Change your **Full name** and **Job title**, and upload a profile photo (PNG, JPEG or WebP; it is cropped to a square in the browser). |
| Notifications | **Sound**: turn the chime on or off, and **Hear it** to try it first. **Email**: **Email my notifications** sends a copy of each notification to your address. If you manage a project you also get **Manager emails**: a digest every Monday and an alert when a production issue or top-priority ticket is raised. |
| Security | Change your password. |
| GitHub | Connect your own GitHub account, which is needed only to [create repositories](#start-a-new-repository). |
| Access tokens | Personal tokens for scripts, CI and the MCP server. See [Access tokens](#access-tokens). |

Every avatar in TaskForge has a coloured rim that shows the person's role, and
hovering an avatar shows the role name. By default: Admin violet, Project
Manager blue, User green, Client amber, AI agent fuchsia.

### Dark mode

Use the sun/moon button in the header (also on the sign-in page) and choose
**Light**, **Dark** or **System**. The command palette's *Appearance* group
does the same.

### Installing TaskForge as an app

TaskForge can be installed on desktops and phones as an app. Use your
browser's own install option (for example the install icon in Chrome's or
Edge's address bar, or **Share → Add to Home Screen** on iOS). The installed app
opens on the Dashboard, and its icon offers shortcuts to **My tickets**,
**Inbox** and **Timesheet**.

---

## 2. Projects

### Creating a project from a template

You need the permission to create projects. Go to **Projects → +** in the
sidebar, or **⌘K → New project**.

1. Fill in **Name**, **Code**, **Description**, **Status**, **Start date**,
   **Target end date** and **Colour**. The code prefixes every ticket key
   (`ATLAS-14`) and **cannot be changed later**, because existing keys depend
   on it.
2. Under **Create from template**, pick a template. It supplies the project's
   statuses, priorities, ticket types and labels, all of which you can change
   afterwards. Each template card shows how many statuses, labels and starter
   tickets it has.
3. If the template has starter tickets, **Also create the N starter tickets**
   creates its parent features with their child tasks already broken down.
4. Choose the **Owner** and any starting members, then create the project.

### Members and teams

**Project → Members** shows everyone with access and how they got it.

Each person has a **project role**:

| Project role | Can |
|---|---|
| Manager | Full control of the project. Managers also receive the project's manager emails and digests. |
| Member | Create and edit tickets. |
| Viewer | Read only. |

- **Add people individually**: **Add members**, pick the people and a
  **Project role**, then add.
- **Attach a team**: under **Teams**, choose **Attach a team…** and press
  **Attach**. Everyone in the team gains access and stays in step with the
  team: someone who joins the team later reaches the project without being
  added. Change the team's role with the dropdown beside it. Teams are created
  in **Workspace → Teams**.

When somebody has access by more than one route, the strongest role wins.

### The project tabs

Opening a project goes to the view chosen in **Project → Settings → Details →
Opens on** (Insights unless changed). The tabs are:

| Tab | What it shows |
|---|---|
| Board | Kanban columns by status. Drag cards between columns to change status. Shows stuck cards, service-target warnings and WIP limits (see [Flow](#4-flow)). |
| Plan | Sprints and milestones above the ranked backlog. See [Planning](#5-planning). |
| Table | Sortable table with **Group**, column visibility, inline editing of status, priority and assignee, and row checkboxes for [bulk edit](#bulk-edit-and-undo). |
| Tree | Parent tickets with their children and roll-up progress. |
| Calendar | Tickets on their due dates. Tickets without a due date do not appear. |
| Timeline | A roadmap of tickets with a start or due date, with a marker for today. |
| Insights | Project health: stat tiles, the [weekly update](#weekly-update), delivery metrics, [Where work waits](#where-work-waits), time this month, completion, trend, priority, status, label and workload charts, and a workload table. |
| Handbook | The project's knowledge-transfer document. See [The handbook](#the-handbook). |
| Recurring | Tickets generated on a schedule. See [Recurring tickets](#recurring-tickets). |
| Labels | Create, edit and delete labels, or **Import labels** from another project. |
| Members | People and teams with access. |
| Activity | The project's audit trail. |
| Settings | Everything in [Project settings](#project-settings). |

Board, Table, Calendar and Timeline share one toolbar of
[filters](#filters-saved-filter-sets-and-describe-a-view), plus **Export** and
**New ticket**.

A person who joined the project in the last 30 days sees a banner, *New to
&lt;project&gt;? Read the handbook — it takes about ten minutes*, until they have
opened the latest version.

### Project settings

**Project → Settings** is one page. Most of it needs the project's
configuration permission (project managers have it by default). Sections, in
order:

| Section | What it controls |
|---|---|
| (link at the top) | **Import from Jira, Trello or a spreadsheet →** |
| Details | Name, description, status, dates and owner. The code is fixed. |
| Behaviour | **Automatic status rollup** (move a parent's status as its children progress), **Allow child tickets**, **Require a due date**, **Private project** (only members can see it; administrators always can), **Opens on** (the landing view), **Default assignee**, **Logo URL**, **Project colour**, and archiving or restoring the project. |
| Repositories | Linked GitHub repositories and the GitHub automation switches. See [section 7](#7-working-with-github-from-a-ticket). |
| Automation | **Project memory**, **Refresh the handbook every Monday**, **TaskForge Triage**, **Morning digest**, **Live updates**. Each row says what it costs. |
| Tickets by email | The project's email address and **Take tickets by email**. |
| Uptime monitors | URLs checked on a schedule; failures open incidents. |
| Production errors | A secret intake URL for Sentry or any app, so errors become tickets. |
| Fields | Custom fields on every ticket in the project. |
| Flow | The stuck threshold and which kinds of ticket service targets apply to. |
| Billing | **Hourly rate** and **Currency**, used by the monthly client report. |
| Statuses | Board columns: name, **Category**, **Work-in-progress limit**, **Before a ticket can enter it** rules, colour, and **Use for new tickets**. |
| Priorities | Name, **Level** (higher sorts first; unique per project), **Service targets**, colour, and the default. |
| Ticket types | Name, **Kind**, **Description template**, **Acceptance criteria** template, colour, and the default. |

Deleting a status, priority or type that tickets use asks where to **Move
tickets to**.

**Custom fields.** **Project → Settings → Fields → Add**. Give it a **Name**,
a **Type** (Text, Number, One choice, Several choices, Date, Yes/no, Link or
Person), **Options** for choice fields (one per line, at least two), optional
**Help text**, and whether it is **Required when creating a ticket**. A field's
type cannot be changed once it exists. Required fields are asked for in the
new-ticket dialog; email and the Copilot can still create tickets without them.

**Ticket kinds.** Every type carries a kind — Task, Feature, Enhancement, Bug
fix, Production issue, Deployment or Research — chosen in **Ticket types**.
Automation reads the kind, not the name, so renaming "Bug" to "Defect" changes
nothing. The kind decides, among other things, the branch prefix, which kinds
service targets apply to, which ticket gets release notes, and where a ticket
lands in release notes and client reports.

### Importing from Jira, Trello or a spreadsheet

**Project → Settings → Import from Jira, Trello or a spreadsheet →** (project
managers). The file is read in your browser.

1. **Choose an export**:
   - Jira: *Filters → Export → CSV (all fields)*.
   - Trello: *Menu → Print, export and share → Export as JSON*.
   - Or any CSV with a header row. Files over 20 MB are refused.

   TaskForge recognises which it is and says how many tickets it found. Up to
   5,000 are imported at a time.
2. **Columns** (CSV and Jira only): each column is shown with an example value
   and a guess at what it is — Original key, Title, Description, Status, Type,
   Priority, Assignee, Reporter, Labels, Due date, Created, Resolved, Story
   points, Parent key, Comment, or ignore. Correct any wrong guesses. One column
   must be the Title.
3. **Values**: map each distinct status, type, priority and person in the file
   to one in the project. People are matched by email, username or name, and
   only project members can be chosen. Anything left unmapped uses the
   project's default (initial status, default type, default priority,
   unassigned).
4. Press **Import N tickets** and watch the progress bar.

What comes across: comments (marked with their original author and date),
labels (created when missing), Trello checklists as acceptance criteria with
their ticks, and parent links. A parent link that would break TaskForge's
two-level hierarchy is listed as *Not linked* rather than forced.

**Nobody is notified**, and **running the same import again skips what is
already there**, so you can import a corrected file safely.

---

## 3. Tickets

### Creating a ticket

Press **New ticket** in a project's toolbar (Board, Table, Calendar or
Timeline), or **⌘K → New ticket**.

| Field | Notes |
|---|---|
| Title | Required. As you type, TaskForge looks for duplicates and suggestions. |
| Description | Markdown, with a toolbar and preview. |
| Acceptance criteria | One criterion per line. |
| Type, Status, Priority, Assignee, Due date, Labels | The project's defaults are preselected. |
| Custom fields | Whatever the project has added; required ones must be filled. |
| Parent ticket | Makes this a child ticket. |

**Templates per type.** Choosing a type fills the description and acceptance
criteria from that type's template — a bug asks for steps to reproduce,
expected and actual behaviour; a deployment for a rollback plan. The template
only fills what is empty (or still another type's untouched template), so
switching type after you have typed keeps your text. Edit the templates in
**Project → Settings → Ticket types**.

**Duplicate warning.** If similar tickets exist, an amber box says *N similar
tickets already exist* and lists them; each opens in a new tab. Similarity is
by meaning, so "Users cannot sign in" finds "Login redirect broken". The
warning never stops you creating the ticket.

**Triage suggestions.** When the project's history agrees, a box shows
*Suggested from N similar tickets* with a type, priority and labels, and the
evidence underneath (for example *6 of 9 similar tickets are Task*). **Apply**
fills them in; **Dismiss** hides the box. When the similar tickets disagree,
nothing is suggested.

If the project **requires a due date**, a ticket without one is refused.

### The ticket page

Open a ticket from any view, or go to `/tickets/DEMO-12`. The main column holds,
top to bottom:

- The key, type, *child of* link (for a child ticket) and the **Follow**
  button, then the title (click to edit) and a progress bar for parents.
- **Description** and **Remarks** (operational notes for whoever picks it up
  next). Click to edit.
- **Acceptance criteria**.
- **Child tickets**.
- A **historical estimate** where there is enough history: *Similar work took
  5 days, 3–8 days*, with the tickets it was based on. Nothing is shown with
  fewer than three comparable finished tickets.
- **Development**, **Fix with AI**, release notes and post-mortem panels, where
  they apply (see [section 7](#7-working-with-github-from-a-ticket)).
- **Linked tickets**, **Attachments**, **Resources**.
- **Discussion** (comments).
- **History**: every recorded change.

The sidebar holds **Status**, **Assignee**, **Priority**, **Type**, **Labels**,
**Sprint or milestone**, **Story points**, **Start date** and **Due date**, then
custom fields, the reporter and dates, **time**, and **flow** (time in status
and service-target clocks). Changes save as you make them; if the server
refuses one, the value goes back and a message says why.

### Writing in Markdown

Descriptions, remarks, the handbook and comments are Markdown. The editor has
**Write** and **Preview** tabs and a toolbar for heading, bold (`⌘B`), italic
(`⌘I`), code, link (`⌘K`), quote, bulleted list, numbered list and checklist.
Headings, lists, task lists, fenced code, quotes, tables, links, ticket keys and
@mentions all render. Raw HTML is never rendered, and only `http(s)`, `mailto`
and in-app links become clickable.

### Acceptance criteria

The checklist of what must be true for the ticket to be done.

- Add one in the field at the bottom (**Add a criterion — paste a list to add
  several**). Pasting several lines adds one criterion per line.
- Tick the box to mark it met. Who ticked it is recorded.
- Edit the text in place, reorder with **Move up** / **Move down**, or remove.
- Cards on the board show the count, such as `2/5`.

The AI agents work against the criteria (the Coder and Planner say how each is
met; the Reviewer gives a verdict per criterion), but only a person ticks the
box. Clients see the list, read-only, as **Done when**.

### Child tickets

TaskForge has two levels: a parent and its children. On a parent, **Child
tickets → Break down** opens *Break down DEMO-12*: type one title per line and
each becomes a child that inherits the parent's type and priority. A child
cannot have children of its own, so the section is hidden on a child.

With **Automatic status rollup** on, the parent's status moves as its children
progress.

### Linked tickets, watchers, attachments and resources

**Linked tickets.** **Linked tickets → Link**, choose *blocks*, *relates to* or
*duplicates*, type the other key (`RC-14`) and press enter. A link is shown on
both tickets. A ticket cannot link to itself, and two tickets cannot block each
other. An unresolved blocker is shown at the top of the list, and the assignee
of a ticket you block is notified.

**Following.** **Follow** at the top of the ticket adds you as a watcher
(anyone who can see the ticket may follow it). The number beside it is how many
people follow it. Followers are notified when the ticket is blocked.

**Attachments.** **Attachments → Upload**, or drop a file on the section. Up
to 5 MB each. Attachments are only served to people who can see the ticket.
SVG files download rather than display.

**Resources.** Links to things that live elsewhere: **Resources → Add**, give a
**Name**, a **Type** (GitHub, SharePoint, Figma, Build, Documentation, API
spec, Other), the URL and optional **Notes**. Fix with AI reads public resource
links and GitHub links the app can see.

### Comments and @mentions

Write in **Discussion** and press the send button or `⌘↵`. Type `@` and part of
a name to pick someone from the project; they are notified. Comments are
Markdown.

- **Reply** threads a reply under a comment; the author is notified.
- **Edit** is available on your own comments.
- **Delete** is available on your own comments, and to people who may delete
  tickets in the project.

### Status rules

A status can require things before a person moves a ticket into it. Set them
in **Project → Settings → Statuses → (edit) → Before a ticket can enter it**:

- Has an assignee
- Is estimated (story points or hours)
- Every acceptance criterion is met
- Has a linked pull request
- Has a merged pull request
- *(any custom field)* is filled in

The rules are checked on every route a person moves a ticket through: the
board, the ticket sidebar, the command palette, bulk edit, the Copilot and a
client's Approve in the portal. A refused move says exactly what is missing:

> Done can’t be reached yet: 2 acceptance criteria are not met and Environment must be filled in.

GitHub automation and parent rollup are not held to these rules, because they
move tickets only on evidence (a merge, children finishing).

### Bulk edit and Undo

In **Table**, tick rows (or the header checkbox for the page). A bar appears
with the count selected and **Status**, **Priority**, assignee and **Add label**
menus, plus **Clear**.

After a bulk edit, the confirmation *Updated N tickets* has an **Undo** button
for ten seconds. Undo restores the status, priority, assignee and labels of
every ticket nobody has changed since. A ticket someone edited in between keeps
the newer edit, and the message names it: *Restored 8. Left DEMO-4 alone —
changed since.* A bulk edit can be undone for up to an hour.

If any ticket in a bulk status change is refused by a [status rule](#status-rules),
nothing is changed and the message names the ticket that stopped it.

### Filters, saved filter sets and Describe a view

The toolbar on Board, Table, Calendar, Timeline and My Tickets has:

- **Search tickets…**
- **Status**, **Priority**, **Type**, **Labels**, **Cycle** (sprints and
  milestones, including *Backlog*), **Assignee**
- **Overdue**
- **Clear** to remove every filter

Filters are part of the page address, so you can share a filtered view by
copying the link.

**Save a filter set.** Apply some filters, then **Save**. Give it a name,
choose whether to **Limit to this project** and whether to **Share with the
team**. Saved sets appear under **Saved** on **My Tickets**; click one to apply
it, or remove it from there.

**Describe a view** (when an AI engine is connected). In the toolbar's
**Describe a view…** box, write what you want, such as *high priority bugs that
are not done*. It becomes ordinary filters in the toolbar, which you can adjust
and save. It only ever filters; it cannot change tickets. If nothing matches it
says *Nothing in that matched a filter. Try naming a person, status or label.*

### Exporting

**Export** in the toolbar downloads exactly the view on screen, filters and
sort included, as **Excel** (real dates and numbers) or **CSV**. The menu shows
how many tickets are in the view. The CSV is safe to open in Excel: cells that
would be read as formulas are neutralised.

### Recurring tickets

**Project → Recurring → New recurring ticket** (needs the recurring
permission). Set a **Schedule name**, the **Ticket title** and **Ticket
description**, **Frequency** (daily, weekly, every two weeks, monthly,
quarterly or yearly) with the **Day of week** or **Day of month** where it
applies, **Due after (days)**, **Start date**, optional **End date**, and the
ticket's status, priority and type.

Each schedule can be **run now**, **paused** and resumed, edited or deleted.
Deleting a schedule keeps the tickets it already created.

---

## 4. Flow

Every status change is recorded, whichever route it came by, so TaskForge can
show where time goes.

### Time in status

The ticket sidebar shows **Time in status**: how long the ticket has spent in
each status in total. A ticket that went back to In Progress adds to that
status's total.

### Where work waits

**Project → Insights → Where work waits** shows the average time finished
tickets spent in each status over the last 90 days, longest first, with:

- **Median cycle time** (first start to done)
- **Service targets met** (percentage and counts)
- **Stuck now**

### The stuck flag

Set **Project → Settings → Flow → Flag a ticket as stuck after N days in
progress, review or blocked**. A card that has been in such a status longer
than that shows **stuck 6d** on the board. Waiting in To Do does not count as
stuck. Leave the field empty to turn the flag off.

### WIP limits

Give a status a **Work-in-progress limit** in **Project → Settings → Statuses**.
The column header then shows `3/4`, amber when full and red when over. The limit
counts everything in the column, not just what your filters show. It is soft:
a move that goes over still happens, with a warning — *In Progress is over its
limit of 4. Finish something there before starting more.*

### Service targets (SLA)

1. In **Project → Settings → Priorities**, edit a priority and set **First
   response within (hours)** and **Resolved within (hours)**.
2. In **Project → Settings → Flow → Service targets apply to**, tick the kinds
   of ticket they apply to, and **Save flow rules**.

The ticket sidebar then shows **First response** and **Resolution** clocks with
the time left, and a clock reads *met*, *met late*, *over*, or *left · paused
while blocked*. The response clock stops at the first reply from someone other
than the reporter. The resolution clock pauses while the ticket is in a Blocked
status, and its due time moves out by the pause.

Board cards show **SLA at risk** and **SLA breached**. At 80% of a target and
again when it is breached, the assignee and the project's managers are notified,
in the app and by email, by **TaskForge Ops**. Each alert is sent once.

---

## 5. Planning

### Sprints and milestones

**Project → Plan** shows every open sprint and milestone above the backlog.

| | Sprint | Milestone |
|---|---|---|
| Is | A timebox | A goal with a due date |
| At once | One running per project | Several, overlapping |
| Suits | Team iterations | Client deliverables |

Create one with **New sprint** or **New milestone** (project managers). Give it
a **Name** (numbered automatically if left empty), a **Goal**, **Starts** and
**Ends**/**Due** dates, and an optional **Capacity** — how much the team expects
to finish, in story points or tickets. Capacity is used by Fill to capacity and
the Planner; it never refuses a ticket.

The project plans in story points as soon as anything in it has points, and in
ticket counts until then.

### Ranking the backlog

The backlog is ranked: the top is what comes next. Drag tickets within it to
rank them, or between the backlog and a cycle to plan them. Without a pointer,
use a ticket's menu to move it **to the top**, **up**, **down**, or into any
cycle. You can also set **Sprint or milestone** in the ticket sidebar.

### Fill to capacity and Ask the Planner

Both propose a list; nothing moves until you apply it.

- **Fill to capacity** takes the backlog in rank order until the cycle's
  capacity is reached. It skips a ticket blocked by unfinished work outside the
  cycle, and counts unpointed tickets at the median of the pointed ones — the
  proposal says which it assumed.
- **Ask the Planner** (when an AI engine is connected) sends the goal, capacity
  and ranked backlog to TaskForge Planner, which returns tickets with a reason
  for each.

Review the proposal and apply it; the confirmation says *Planned N tickets*.

### Starting and closing

From the cycle's **⋯** menu: **Start**, **Close…**, **Edit** or **Delete**
(deleting returns its tickets to the backlog). Only one sprint can run at a
time; starting a second says *Another sprint is already running in this
project. Close it first.*

**Close…** asks where to **Move unfinished tickets to** — another cycle or *The
backlog*. The cycle keeps a record of what carried over, and the confirmation
reads *Sprint 4 closed: 12 finished, 3 carried over.*

### Burn-up

**Burn-up** on a cycle opens its page: dates, **Done** against scope, **Added
since start**, **Capacity**, and a burn-up chart built from recorded history.
Scope added mid-cycle shows as the top line rising, rather than being hidden in
a flatter slope.

### Forecasts

Each sprint and milestone shows a forecast such as *85% likely by 17 Oct · 50%
by 12 Oct · 72% chance of 20 Oct*. It replays the team's real daily throughput
from the last eight weeks thousands of times; nobody is asked to estimate. The
chance of the due date is green at 85% or above, amber from 50% and red below.
Hover the line to see how many simulations and days it used. With too little
history it says so instead of guessing; when everything planned is finished it
says *All the planned work is done.*

Forecasts appear on the Plan tab, the cycle page, and in the client portal
under *Coming up*.

---

## 6. Time

### The timer

On a ticket, **Start timer** in the sidebar's time section. The timer then
appears in the header on every page; click it to stop, and the time is logged
(*Logged 1h 20m on DEMO-12*). You can have one timer running; starting another
stops the first.

### Logging time afterwards

On the ticket, open **Log**, then enter:

- **Duration**: `45`, `45m`, `1.5h`, `1,5h`, `1h 30m`, `1h30`, `1:30` or `1d`
  (eight hours). Anything TaskForge cannot read whole is refused rather than
  guessed. One entry can be up to 24 hours.
- **Date**: today unless you choose another. Future days are refused.
- **What was done** (optional note).
- **Billable**: on by default.

Then press **Log 1h 30m**.

Logging time needs permission to edit the ticket, so clients cannot log hours.
Entries belong to the person who logged them; a project manager may remove one.

### Where hours show

| Place | Shows |
|---|---|
| The ticket | Total against the estimate, each person's share, billable time where it differs, and **Entries**. |
| Timesheet (sidebar) | Your week, a row per ticket and a column per day, with previous/next week and **This week**. Read-only: time is logged on the ticket. |
| Project → Insights → Time | This month: hours logged and billable, by person, by kind of work, and the tickets that took most. |
| Monthly client report | Billable hours, and with a rate set, the amount. |

### Billable rate

**Project → Settings → Billing**: set the **Hourly rate** and **Currency**. The
monthly client report then shows the billable amount. Staff also see
non-billable time and who logged what; clients do not.

---

## 7. Working with GitHub from a ticket

These features need the workspace's GitHub App (set up by an administrator in
**Workspace → Integrations → Connect GitHub**) and at least one repository
linked to the project.

### Linking repositories

**Project → Settings → Repositories**: pick a repository the app can see,
optionally give it a role (*API*, *Tablet app*) and link it. A project can have
several. **Sync** asks GitHub for the latest branches, pull requests and
commits, which is useful if a webhook was missed.

The same section has the project's GitHub switches:

| Switch | Effect |
|---|---|
| Move tickets from GitHub | Branches, pull requests and merges move tickets forward (below). |
| Let Fix with AI write CI workflows | Allows changes to `.github/workflows`. Off by default. |
| Fix failing CI on AI pull requests automatically | Heals a red AI pull request, at most twice each. |
| Open AI pull requests as drafts until CI passes | Drafts are marked ready when every check passes. |
| Auto-merge small, green, reviewed AI pull requests | Off by default; set **At most (lines changed)** and the allowed kinds. |

### Branch names and what links to a ticket

The ticket's **Development** section shows a suggested branch name and a copy
button that copies `git checkout -b <name>`. The prefix comes from the ticket's
kind:

| Kind | Prefix |
|---|---|
| Bug fix | `fix/` |
| Production issue | `hotfix/` |
| Feature, Enhancement | `feat/` |
| Deployment | `release/` |
| Research | `spike/` |
| Task | `chore/` |

Any branch, pull request or commit in a linked repository that mentions the
ticket's key (`DEMO-2`) is listed under **Development**, with pull request state
and CI status (passed, failed, running).

With **Move tickets from GitHub** on, a branch moves the ticket to In Progress,
an open pull request to Review, and a merge to Done. It only ever moves a
ticket forward, never touches Done or Cancelled, and records the move as
**GitHub** in the history.

### Deployments, preview links and rollback

Deployments that your host reports to GitHub (Vercel, Netlify and others) are
listed under **Development → Deployments** with their state. A preview
deployment of the ticket's branch gets an **Open preview** link — the link a
client can try. When the change reaches production the heading shows **Live in
Production**, and a merged ticket moves to Done when it ships.

With a Vercel token on **Workspace → Integrations → Vercel**, project managers
see **Roll back** on the live production deployment. It asks for confirmation,
then re-points production at the previous successful deployment.

### Fix with AI

Needs the `ai:code` permission (Admin only by default) and a connected AI
engine.

1. On the ticket, **Fix with AI**.
2. Choose the **Engine** and the **Repository** (or all linked repositories).
3. Choose **Write the fix** (opens a pull request) or **Plan first** (posts a
   plan to approve; changes nothing).
4. Optionally add **Extra guidance**: where to look, what not to touch.
5. Start.

The model reads the whole ticket — description, criteria, comments, text
attachments, parent and linked tickets, resources — reads the repository,
stages a change, and TaskForge opens a pull request on the ticket's branch. The
steps it took, the engine, model and tokens are shown on the ticket. It never
merges, and it cannot run the code or the tests; the repository's CI checks its
work.

**Plan first.** The Planner posts its approach, files, risks and what is out of
scope as a comment. When it has finished, **Build this plan** hands the
approved plan to the Coder.

**Heal CI.** When a pull request's checks fail, **Checks failing → Fix failing
checks** has the Coder read the failures and push a fix onto the same branch.

**AI review.** Each open pull request is listed with **AI review**. The
Reviewer posts a GitHub review with inline comments and a verdict per
acceptance criterion. It always comments; it never approves. AI pull requests
are reviewed automatically.

#### Start a new repository

**Start a new repository from this ticket** (project managers, with your own
GitHub account connected in **Settings → GitHub**). Choose the **Owner** (you or
an organisation) and **Name**, then **Create and scaffold**. The repository is
created as you, linked to the project, and the Coder builds its first version
from the ticket as a pull request.

### Release notes

On a ticket whose type has the **Deployment** kind, **In this release** lists
every ticket finished since the previous release. **Draft release notes** posts
client-readable notes as a comment; **Draft and publish a GitHub release**
(project managers) also publishes them as a GitHub release.

### Post-mortems

On a ticket whose type has the **Production issue** kind, **Draft post-mortem**
has TaskForge Ops write one from the record — the ticket, its history, its
error groups and recent deployments — and post it as a comment. Where the
record does not say, the draft says "unknown from the record" rather than
guess.

### Production errors and uptime

- **Project → Settings → Production errors** issues a secret intake URL (shown
  once) for a Sentry webhook or a plain JSON post. Repeated errors are grouped
  into one ticket with a count, filed by TaskForge Triage with the stack and
  suspect changes. An error that returns after its ticket is closed reopens it.
- **Project → Settings → Uptime monitors**: add a **Name**, **URL** and an
  optional **Must contain** text. Two failed checks open an incident; recovery
  is posted with how long the outage lasted. Only public addresses can be
  monitored.

Delivery metrics (deployment frequency, lead time, change failure rate, time to
restore) appear on **Project → Insights**.

---

## 8. AI helpers

AI features appear only when an administrator has connected an AI engine in
**Workspace → AI** (or on the server). Without one, the Copilot and Capture
buttons are hidden.

### The Copilot

Open it with `⌘J` or the sparkle in the header. It knows which project, ticket
and filters you are looking at, so *assign this to me* or *how many are there*
refer to the screen.

What it can do:

- Create a ticket, or a parent with its tasks (*Create tasks for the
  authentication module: Login API, Login UI, Password Reset API, Password
  Reset UI*).
- Search tickets (*show my critical tickets*), read one in full.
- Update status, priority, assignee, title, due date and labels.
- Comment on a ticket, with @mentions.
- Report project health, and check for duplicates.
- Search project memory (*how did we add Apple Pay?*).

There is no delete tool: it cannot delete anything.

**Approving writes.** Reads run straight away. Anything that would change data
is shown first as a card — *Approve this change?* with the exact fields — and
nothing is written until you press **Approve** (or **Approve all N**). **Cancel**
leaves everything as it was. The Copilot has exactly your permissions: a change
you may not make is refused before you are asked.

What each tool actually did is shown as a card above the Copilot's reply, so
you can check the result without relying on the wording.

**Slash commands** skip the model entirely, so they are instant and use no AI
quota. Start typing `/` to see them:

| Command | Does |
|---|---|
| `/find <text>` | Search tickets |
| `/mine` | Tickets assigned to me |
| `/overdue` | Everything past its due date |
| `/blocked` | Everything currently blocked |
| `/unassigned` | Work nobody owns yet |
| `/ticket RC-14` | Read one ticket in full |
| `/insights` | How this project is doing |
| `/dupes <title>` | Check for similar tickets |
| `/new <title>` | Create a ticket |
| `/comment RC-14 <text>` | Comment on a ticket |
| `/assign RC-14 <person>` | Assign a ticket |
| `/move RC-14 <status>` | Change a ticket's status |

Writing commands still show the approval card.

**Voice.** The microphone button dictates a message. It uses the browser's own
speech recognition where available and otherwise records and transcribes; it is
hidden where neither is possible.

**Chats.** **New chat** starts over; **Previous chats** reopens earlier ones;
each can be deleted. `Enter` sends, `Shift+Enter` adds a line.

### Capture

The wand in the header, or **⌘K → Capture notes as tickets**. Paste a meeting
note, chat thread, email or stack trace (at least a couple of sentences). It
becomes **Review the breakdown**: one parent with its tasks, assignees and
labels. Nothing is written until you press **Create N tickets**; **Back to
notes** lets you adjust the text.

### Describe a view

See [Filters](#filters-saved-filter-sets-and-describe-a-view).

### Weekly update

**Project → Insights → Weekly update → Write it**. A client-ready paragraph
written from the last seven days, with the counted facts it was written from
shown underneath so you can check it. **Copy** puts it on the clipboard;
**Regenerate** writes it again.

### Project memory

With **Project → Settings → Automation → Project memory** on (the default),
TaskForge indexes finished tickets, the linked repositories' README and `docs/`,
and the handbook, so the Copilot and the agents can find how something was done
before. It is refreshed nightly, and **Reindex now** rebuilds it on demand. Turning
it off deletes the index. It is capped at 3,000 pieces per project.

### The handbook

**Project → Handbook** is the document for someone joining the project: its
people, workflow, code, current focus and decisions, ending with *Your first
week*. It is written from what the project already records.

- **Write the handbook** (project managers) creates the first version. With no
  AI engine connected, it is assembled from the facts alone.
- **Regenerate** writes a new version; **Edit** lets a project manager change
  it and **Save as a new version**.
- Pick any earlier version from the version menu, and download one as `.md`.
- **Refresh the handbook every Monday** in **Project → Settings → Automation**
  keeps it current.

New members see a banner pointing to it for their first month.

### TaskForge Triage

Turn on **Project → Settings → Automation → TaskForge Triage**. For every new
ticket, from any route (dialog, email, Teams, the API), Triage fills in what was
left at its defaults — type, priority, labels, points and an assignee — from
similar past work, and explains itself in a comment. It never overwrites what a
person chose, and never assigns a client.

The ticket then shows *TaskForge Triage set …* with **Undo**, which puts back
everything nobody has changed since.

### Morning digest

Turn on **Project → Settings → Automation → Morning digest**. Each morning the
project's managers receive what is stuck, at risk of or past its service
target, due in three days or overdue, and waiting on the client, plus
yesterday's finished count and the running sprint's forecast — by email and in
linked Teams channels. A quiet day sends nothing. It uses no AI.

This is separate from the Monday **Manager emails** digest, which each manager
switches on or off in **Settings → Notifications**.

### The AI agents

The agents appear in history, comments and usage under their own names:
**TaskForge Coder**, **Planner**, **Reviewer**, **Release Manager**, **Triage**
and **Ops**. They are workspace members with the *AI agent* role and can never
sign in.

---

## 9. Email in and the Microsoft Teams bot

### Filing a ticket by email

When an administrator has turned on email in, and a project manager has turned
on **Project → Settings → Tickets by email → Take tickets by email**, the
project has its own address, shown there with a copy button. It is the
workspace mailbox with the project code added, for example
`mailbox+demo@gmail.com` for project DEMO.

Send your request to it:

- The subject becomes the title and the body the description. With *Structure
  with the Copilot* on, the email is turned into a title, a tidy description,
  a type, a priority and acceptance criteria (including any `- [ ]` lines you
  wrote), and your original email is kept, quoted, at the bottom.
- Attachments come along, within the usual limits.
- You get a reply with the new key and a link.

You must send from the email address on your TaskForge account, and your mail
server must authenticate you (DMARC, DKIM or SPF), which ordinary work and
personal mail does. You act with your own permissions: a client can file into
their project, and nobody can do by email what they could not do in the app.
If no account uses your address you get *We couldn’t file your email*.

### Replying to comment

Reply to any TaskForge email about a ticket — a notification, or the
confirmation of a ticket you emailed — and your reply becomes a comment on that
ticket. The quoted history and signature are removed. Replies work even if your
mail client drops the Reply-To, because the subject carries `[DEMO-12]`. You can
also email a ticket's own address, such as `mailbox+demo-12@gmail.com`.

### The Microsoft Teams bot

Once an administrator has installed the TaskForge bot in Teams, write to it in
a chat, or @mention it in a project's channel, and describe what you need. It
asks at most a couple of short questions at a time and keeps a **draft ticket**
card showing the title, type, priority, description, criteria, similar existing
tickets and who has shaped it. Several people can add to the same thread.

When it looks right, anyone presses **Create ticket** (or types `create`). It
is filed as the person who pressed it, and the bot replies with the key and a
link.

You are matched to your TaskForge account by your Teams email the first time
you write. If there is no match, the bot says so and asks you to have your
account added with the email you use in Teams.

| Command | Does |
|---|---|
| `help` (or `?`) | Shows what the bot can do. |
| `use DEMO` | In a chat: file into project DEMO. |
| `link DEMO` | In a channel: tie the channel to DEMO. Tickets shaped there go to DEMO, and DEMO's new tickets are posted to the channel. Needs permission to configure the project. |
| `unlink` | Untie a linked channel. |
| `mute` / `unmute` | Stop or restart posting new tickets in a linked channel. |
| `DEMO-12` | Show that ticket's title, status, priority and assignee. |
| `create` (also `file it`, `ship it`) | File the draft. |
| `discard` (also `start over`, `cancel`) | Throw the draft away. |

If you try to create without choosing a project, the bot asks *Which project is
this for? Reply `use CODE`.* A ticket that came from Teams is not echoed back
into the channel.

---

## 10. The client portal

Clients have the **Client** role and are added to their projects as members.
They always land in the portal, and can also reach their own **Settings**.

For each project, the portal shows:

| Section | What it holds |
|---|---|
| New request | File a request: *What do you need?* and the details (what happens now, what should happen, where). |
| Waiting for your approval | Work in a Review status, with **Try the preview** where a preview deployment exists, and **Approve**. |
| Your requests | What you filed and where each stands. |
| Shipped in the last 30 days | What went live. |
| Coming up | Forecasts for the project's sprints and milestones. |
| Monthly report | A link to the printable report. |

**Approving.** **Approve** asks *Approve DEMO-12? It will be marked done.* and
moves the ticket to Done. Only work waiting for review can be approved, and the
project's [status rules](#status-rules) still apply.

**A request's page** shows its description, **Done when** (the acceptance
criteria, read-only), preview or live links, and the **Conversation**, where
the client can reply to the team.

**Monthly report.** Delivered work grouped by kind, time (billable hours and,
with a rate set, the amount), releases, and reliability (incidents and uptime).
**← Previous month** goes back; **Print or save as PDF** prints it. Incident
titles are shown only as "Production issue (KEY)", because error reports can
contain customer data. Staff with AI administration also see the project's AI
spend for the month, marked *staff only, not shown to clients*.

---

## 11. Administration

**Workspace** in the sidebar holds the administration pages. Each appears only
for someone holding its permission.

| Page | Needs |
|---|---|
| People | `user:view` |
| Roles | `role:manage` |
| Teams | `team:manage` or `team:manage-members` |
| Templates | `template:manage` |
| AI | `ai:manage` |
| Integrations | `integration:manage` |
| Sessions | `user:view` |

### People

**Workspace → People → New user**: name, **username**, email, job title, role
and a temporary password. **Require a password change** (on by default) makes
the password work for one sign-in. **Email sign-in details** sends the welcome
email; if email is not set up, or sending fails, you are told to pass the
password on yourself.

Each person's **⋯** menu has **Edit**, **Reset password** (the same email and
password-change options, and every session is ended) and **Deactivate** /
**Reactivate**. You cannot deactivate yourself.

### Roles and permissions

**Workspace → Roles** lists every role with its rank and avatar colour.

- **Permissions are a fixed catalogue**; a role is a choice of them. Examples:
  `project:create`, `project:manage-config`, `project:manage-members`,
  `ticket:create`, `ticket:update`, `ticket:transition`, `ticket:approve`,
  `comment:create`, `recurring:manage`, `ai:use`, `ai:code`, `ai:manage`,
  `integration:manage`.
- **Ranks.** Every role has a rank; lower ranks higher, and Admin is 0. You can
  only create, edit, assign or delete roles ranked strictly below your own, and
  only give a role permissions you hold yourself. The editor greys out the rest.
- **Admin cannot be changed**, so there is always a way to undo a mistake.
  Project Manager and User can be edited but not deleted.
- **Avatar rim colour** is set per role here.

A person's access to a project combines their workspace role with their
[project role](#members-and-teams).

### Teams

**Workspace → Teams → New team**. Add people with **Add someone…** and mark
team managers. Someone with `team:manage-members` can administer the people in
teams they manage, but not people who outrank them, and cannot appoint further
managers. [Attach a team](#members-and-teams) to a project to staff it.

### Templates

**Workspace → Templates** lists the project templates with their statuses,
labels and starter tickets, and marks the default. Create a project from one
with **New project**.

### AI engines, agents, budgets and reports

**Workspace → AI** has five tabs.

- **Engines.** One card per provider. Enable it, paste an API key (stored
  sealed; it overrides the server's environment), choose a model from the list
  the provider's own API reports, and choose **How you pay**: *Free tier —
  nothing billed*, *Pay as you go — list price* or *Custom rate — what we
  actually pay*. **Test** sends a tiny request so a bad key shows up now.
  **Add an engine** offers many providers, including any OpenAI-compatible
  endpoint; each states its free-tier terms and where requests are processed.
  Above the cards, choose which engine **Copilot, capture, filters and weekly
  update use** and which **Fix with AI offers first**. **Refresh prices**
  fetches current list prices, keeping any you set by hand.
- **Usage.** Spend and tokens by person, project, engine and feature, with a
  daily timeline and a projection for the month.
- **Budgets.** Monthly limits for the whole workspace, one project or one
  engine. They email at 80% and 100%. Only a budget marked **Hard stop** refuses
  new Copilot turns and AI fixes once spent.
- **Reports.** Subscribe a person or a whole team to the weekly usage email or
  to budget alerts; send the report now.
- **Agents.** Choose an engine and model for each agent (Copilot, Coder,
  Planner, Reviewer, Release Manager, Ops), with recommendations from connected
  engines only, or reset one to the workspace default. The Coder's pull
  requests are listed per repository — merged, closed unmerged, open — with an
  acceptance rate.

### Integrations

**Workspace → Integrations**:

| Card | What it does |
|---|---|
| Connect GitHub | Choose **My GitHub account** or **An organisation**, then **Create GitHub App**. GitHub pre-fills the app; you confirm, install it on all or some repositories, and return here. Connected accounts and their repositories are listed, and a webhook address can be set. |
| Vercel | A token (and team id if needed) that enables **Roll back** on tickets. |
| Email in | **Read the mailbox** and **Structure with the Copilot**, a log of every message read and what became of it, and **Check now**. |
| Microsoft Teams | Paste the bot's **Bot (app) ID**, **Tenant ID** and **Client secret** from the Teams Developer Portal; credentials are checked with Microsoft before saving. Then download the app package and upload it in Teams. |
| API and webhooks | Outbound webhooks for one project or all, with a **Test** button; failed deliveries are retried for about eight hours. |

### Sessions

**Workspace → Sessions** lists recorded sign-ins: who, the client they used, and when. The button on
a row signs that person out everywhere, immediately.

### Access tokens

**Settings → Access tokens → New access token** (anyone). A token acts as you,
with exactly your permissions, and everything it does is recorded under your
name. It is shown once — copy it then; only a hash is stored. Use it for the
REST API, scripts, CI or the MCP server (see [docs/MCP.md](MCP.md) and
[docs/API.md](API.md)). Revoke a token from the same page.

---

## 12. Troubleshooting and FAQ

**"Done can’t be reached yet: …"**
The status has [rules](#status-rules). The message lists what is missing — an
assignee, an estimate, unmet criteria, a pull request, a field. Fix those and
move the ticket again.

**A card moved over the WIP limit and I got a warning.**
WIP limits are soft. The move happened; the warning is a nudge.

**"Another sprint is already running in this project. Close it first."**
Only one sprint runs at a time. Close the running one, or use milestones, which
may overlap.

**"This project requires a due date on every ticket."**
**Require a due date** is on in **Project → Settings → Behaviour**. Set a due
date, or ask a project manager to switch it off.

**"This project is archived. Restore it before adding tickets."**
Restore it from **Project → Settings → Behaviour**.

**"Write a duration like 45m, 1h 30m, 1.5h or 1:30."**
The time entry could not be read whole. Use one of the
[accepted formats](#logging-time-afterwards). Future days are refused, and one
entry is at most 24 hours.

**"Bulk edits can be undone for an hour."**
The hour has passed. Change the tickets back by hand.

**I cannot find the Copilot or Capture buttons.**
No AI engine is connected. An administrator connects one in **Workspace → AI**.
Fix with AI, when run with no engine, says *No AI engine is configured. Connect
one on Workspace → AI.*

**"AI budget reached: …"**
A hard-stop budget in **Workspace → AI → Budgets** is spent for this month.
An administrator can raise it or turn off Hard stop.

**"Your role cannot start AI fixes (ai:code)."**
Fix with AI needs the `ai:code` permission, which is Admin-only by default.

**"GitHub refused to write a workflow file (.github/workflows)."**
Workflow files need their own GitHub permission. In the TaskForge app's
settings on GitHub, set **Repository permissions → Workflows** to **Read and
write**, then accept the new permission on the installation. The project must
also have **Let Fix with AI write CI workflows** on.

**"GitHub refused the write."**
The app needs read and write access to Contents and Pull requests on the
repository. Update its permissions on GitHub and accept them on the
installation.

**"Someone pushed to the pull request while the fix was being written."**
Run it again.

**"CI workflow files cannot be changed here."**
The project has not allowed workflow changes. A project manager can turn on
**Let Fix with AI write CI workflows** in **Project → Settings → Repositories**.

**"A fix is already running for this ticket."**
Wait for it to finish. A run that stops reporting back is marked failed after
fifteen minutes.

**I cannot create a repository from a ticket.**
Connect your own GitHub account in **Settings → GitHub**. The workspace's app
needs **Administration: Read and write** and the callback URL shown on that
page, both set in the app's settings on GitHub.

**My ticket did not move when I opened a pull request.**
Check that the pull request, branch or commit mentions the ticket key, that the
repository is linked to the project, and that **Move tickets from GitHub** is
on. GitHub automation never moves a ticket backwards or out of Done or
Cancelled. Press **Sync** in **Project → Settings → Repositories** to catch up.

**My email did not become a ticket.**
Send from the address on your account, to the project's address, and check
that the project has **Take tickets by email** on. An administrator can see
what happened to each message on **Workspace → Integrations → Email in**.

**The Teams bot says it does not know who I am.**
Your Teams email does not match a TaskForge account. Ask an administrator to
use the same address.

**Single sign-on says my account is not in this workspace.**
Your administrator must create your account with the same email your provider
uses.

**I am not getting notification emails.**
Check **Email my notifications** in **Settings → Notifications**. If the
workspace has no outgoing mail configured, no email is sent.
