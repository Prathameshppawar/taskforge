# TaskForge — Entity Relationship Model

## 1. Overview diagram

```
                       ┌──────────┐
                       │  roles   │
                       └────┬─────┘
                            │ 1
                            │
                            │ N
                       ┌────▼─────┐         ┌───────────────┐
                       │  users   │────1:N──│ user_sessions │
                       └────┬─────┘         └───────────────┘
      ┌─────────────────────┼──────────────────────┬────────────────┐
      │ owner               │ member               │ assignee       │ author
      │                     │                      │                │
┌─────▼──────┐  1:1  ┌──────▼──────────┐    ┌──────▼──────┐  ┌──────▼────────┐
│  projects  │───────│ project_settings│    │   tickets   │  │   comments    │
└─────┬──────┘       └─────────────────┘    └──────┬──────┘  └──────┬────────┘
      │                                            │                │ self-ref
      │ 1:N                                        │ self-ref       │ (threads)
      ├──────────────┬──────────────┬──────────────┤ (parent/child) │
      │              │              │              │                │
┌─────▼─────┐ ┌──────▼───┐ ┌────────▼──┐ ┌─────────▼────────┐ ┌─────▼──────────┐
│ statuses  │ │ labels   │ │priorities │ │ ticket_labels    │ │comment_mentions│
└───────────┘ └──────────┘ │ticket_types│ │ ticket_resources │ └────────────────┘
                           └───────────┘ └──────────────────┘

┌───────────────────┐ 1:N  ┌──────────────────────────────────────────┐
│ project_templates │──────│ template_statuses / _priorities /        │
└─────────┬─────────┘      │ _ticket_types / _labels / _tickets        │
          │ 1:N            └──────────────────────────────────────────┘
          └──────────────► projects   (a project is instantiated from a template)

┌──────────────────┐ 1:N ┌────────────────────────┐
│ recurring_tickets│─────│ recurring_ticket_labels│
└────────┬─────────┘     └────────────────────────┘
         └── 1:N ──► tickets   (generated occurrences)

┌───────────────┐ 1:N ┌────────────────────────┐
│ saved_filters │─────│ saved_filter_criteria  │
└───────────────┘     └────────────────────────┘

┌────────────────┐
│ activity_logs  │  ── nullable FKs to projects / tickets / users (actor)
└────────────────┘     append-only unified timeline
```

## 2. Relationship catalogue

### Identity
| From | To | Cardinality | On delete | Notes |
|---|---|---|---|---|
| `users.roleId` | `roles.id` | N:1 | `RESTRICT` | A role in use cannot be deleted. |
| `users.createdById` | `users.id` | N:1 self | `SET NULL` | Who provisioned the account. |
| `user_sessions.userId` | `users.id` | N:1 | `CASCADE` | Login audit trail. |

### Projects
| From | To | Cardinality | On delete | Notes |
|---|---|---|---|---|
| `projects.ownerId` | `users.id` | N:1 | `RESTRICT` | A project always has an owner. |
| `projects.templateId` | `project_templates.id` | N:1 | `SET NULL` | Deleting a template preserves its projects. |
| `project_settings.projectId` | `projects.id` | **1:1** | `CASCADE` | Split out so project lists stay cheap. |
| `project_members` | `projects` + `users` | N:M via join | `CASCADE` | `UNIQUE(projectId, userId)`. Carries `role` + `joinedAt`. |

### Workflow configuration (all project-scoped)
| Table | Unique constraint | Purpose |
|---|---|---|
| `statuses` | `(projectId, name)`, `(projectId, position)` implied by index | Kanban columns. `category` gives semantics. |
| `priorities` | `(projectId, name)`, `(projectId, level)` | `level` drives sorting. |
| `ticket_types` | `(projectId, name)` | Task / Bug / Story / … |
| `labels` | `(projectId, name)` | Labels are project-specific by design. |

### Tickets
| From | To | Cardinality | On delete | Notes |
|---|---|---|---|---|
| `tickets.projectId` | `projects.id` | N:1 | `CASCADE` | |
| `tickets.statusId` / `priorityId` / `typeId` | config tables | N:1 | `RESTRICT` | Config in use cannot be deleted; the UI offers reassignment. |
| `tickets.assigneeId` / `reporterId` / `createdById` | `users.id` | N:1 | `SET NULL` | Tickets outlive user records. |
| `tickets.parentId` | `tickets.id` | N:1 self | `SET NULL` | **Max depth 2**, enforced in the domain layer. |
| `ticket_labels` | `tickets` + `labels` | N:M join | `CASCADE` | Composite PK `(ticketId, labelId)`. |
| `ticket_resources.ticketId` | `tickets.id` | 1:N | `CASCADE` | External links only — no file storage. |

### Collaboration & audit
| From | To | Cardinality | On delete | Notes |
|---|---|---|---|---|
| `comments.parentId` | `comments.id` | N:1 self | `CASCADE` | Threaded replies. Soft-deleted via `deletedAt` to keep threads intact. |
| `comment_mentions` | `comments` + `users` | N:M join | `CASCADE` | |
| `activity_logs.projectId` / `ticketId` | respective | N:1 nullable | `CASCADE` | Scoping FKs for cheap filtering. |
| `activity_logs.entityId` | — | *not* an FK | — | Deliberate: the log must survive deletion of its subject. `entityLabel` snapshots the name. |

### Automation
| From | To | Cardinality | On delete | Notes |
|---|---|---|---|---|
| `recurring_tickets.projectId` | `projects.id` | N:1 | `CASCADE` | |
| `tickets.recurringTicketId` | `recurring_tickets.id` | N:1 | `SET NULL` | Generated occurrences survive schedule deletion. |
| `saved_filter_criteria.savedFilterId` | `saved_filters.id` | 1:N | `CASCADE` | Criteria are rows, not a JSON blob. |

## 3. Normalization notes

The schema is in **third normal form** throughout. Two choices are worth calling out:

1. **No JSON columns.** Saved-filter criteria and audit diffs are the two places
   where a JSON blob is tempting. Both are modelled relationally
   (`saved_filter_criteria` rows; `field`/`oldValue`/`newValue` columns) so they
   stay queryable — "which saved filters reference this label?" is a join, not a
   full scan.

2. **Two deliberate denormalizations**, both justified:
   - `tickets.key` (e.g. `AUTH-14`) duplicates `project.code + ticket.number`.
     It is unique and indexed, which makes the command palette and AI ticket
     lookups a single index hit instead of a join + string concat.
   - `activity_logs.entityLabel` snapshots the subject's name at write time, so
     the timeline still reads correctly after a rename or delete.

## 4. Index coverage

Indexes are placed to cover the exact access patterns the UI generates:

| Query the UI makes | Index serving it |
|---|---|
| Board for a project, grouped by column, ordered | `tickets(projectId, statusId, position)` |
| Project ticket list excluding archived | `tickets(projectId, isArchived)` |
| "My Tickets" split by status | `tickets(assigneeId, statusId)` |
| Child tickets of a parent / tree view | `tickets(parentId)` |
| Calendar + overdue rollups | `tickets(dueDate)` |
| Command palette / AI lookup by key | `tickets.key` (unique) |
| Sequential numbering integrity | `tickets(projectId, number)` (unique) |
| Filter by priority / type / reporter | `tickets(priorityId)`, `(typeId)`, `(reporterId)` |
| Label filter (reverse lookup) | `ticket_labels(labelId)` |
| Project activity timeline | `activity_logs(projectId, createdAt)` |
| Ticket activity timeline | `activity_logs(ticketId, createdAt)` |
| "What did this user do?" | `activity_logs(actorId, createdAt)` |
| History for a deleted entity | `activity_logs(entityType, entityId)` |
| Comment thread, chronological | `comments(ticketId, createdAt)` |
| Scheduler sweep for due recurrences | `recurring_tickets(isActive, nextRunAt)` |
| Member lookup / permission checks | `project_members(projectId, userId)` unique, `(userId)` |
| Kanban column ordering | `statuses(projectId, position)` |
| Active user directory | `users(isActive)`, `users(name)` |
