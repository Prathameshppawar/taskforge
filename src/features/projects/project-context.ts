import { prisma } from '@/infrastructure/db/prisma'
import { canInProject } from '@/core/domain/rbac'
import {
  projectVisibilityFilter,
  requireActor,
  requireProjectView,
  can,
} from '@/features/auth/guards'
import type { TicketFormConfig } from '@/features/tickets/components/create-ticket-dialog'

/**
 * Everything a project view needs to render its toolbar and create-dialog:
 * the workflow configuration, the member list and the viewer's capabilities.
 */
export async function getProjectViewContext(projectId: string) {
  const { actor, access } = await requireProjectView(projectId)

  const [statuses, priorities, types, labels, members, parents] = await Promise.all([
    prisma.status.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, color: true, category: true },
    }),
    prisma.priority.findMany({
      where: { projectId },
      orderBy: { level: 'desc' },
      select: { id: true, name: true, color: true, level: true },
    }),
    prisma.ticketType.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, color: true },
    }),
    prisma.label.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true },
    }),
    prisma.projectMember.findMany({
      where: { projectId, user: { isActive: true } },
      select: {
        user: {
          select: { id: true, name: true, username: true, avatarColor: true, jobTitle: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.ticket.findMany({
      where: { projectId, parentId: null, isArchived: false },
      select: { id: true, key: true, title: true },
      orderBy: { number: 'desc' },
      take: 100,
    }),
  ])

  const formConfig: TicketFormConfig = {
    projectId,
    statuses,
    priorities,
    types,
    labels,
    members: members.map((m) => m.user),
    parents,
  }

  return {
    actor,
    access,
    projectId,
    formConfig,
    statuses,
    priorities,
    types,
    labels,
    members: members.map((m) => m.user),
    can: {
      createTicket: canInProject(access, 'ticket:create'),
      updateTicket: canInProject(access, 'ticket:update'),
      transition: canInProject(access, 'ticket:transition'),
      manageLabels: canInProject(access, 'label:create'),
      manageMembers: canInProject(access, 'project:manage-members'),
      manageConfig: canInProject(access, 'project:manage-config'),
      deleteTicket: canInProject(access, 'ticket:delete'),
      archiveProject: canInProject(access, 'project:archive'),
      manageRecurring: canInProject(access, 'recurring:manage'),
    },
  }
}

export type ProjectViewContext = Awaited<ReturnType<typeof getProjectViewContext>>

/**
 * Workspace-wide context for cross-project views (My Tickets, global activity).
 *
 * Statuses, priorities and types are project-scoped, so the same name exists
 * once per project. They are de-duplicated by name here: the filter bar should
 * offer "In Progress" once, and selecting it must match that status in every
 * project the viewer can see.
 */
export async function getWorkspaceViewContext() {
  const actor = await requireActor()
  const visibility = projectVisibilityFilter(actor)

  const [statuses, priorities, types, labels, members] = await Promise.all([
    prisma.status.findMany({
      where: { project: visibility },
      select: { id: true, name: true, color: true, category: true, position: true },
      orderBy: { position: 'asc' },
    }),
    prisma.priority.findMany({
      where: { project: visibility },
      select: { id: true, name: true, color: true, level: true },
      orderBy: { level: 'desc' },
    }),
    prisma.ticketType.findMany({
      where: { project: visibility },
      select: { id: true, name: true, color: true, position: true },
      orderBy: { position: 'asc' },
    }),
    prisma.label.findMany({
      where: { project: visibility },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, username: true, avatarColor: true, jobTitle: true },
      orderBy: { name: 'asc' },
    }),
  ])

  /**
   * Collapses same-named config rows into one filter entry whose id carries
   * every underlying id, so filtering by "High" catches all projects.
   */
  function dedupe<T extends { id: string; name: string; color: string }>(rows: T[]): T[] {
    const byName = new Map<string, { row: T; ids: string[] }>()
    for (const row of rows) {
      const existing = byName.get(row.name)
      if (existing) existing.ids.push(row.id)
      else byName.set(row.name, { row, ids: [row.id] })
    }
    return [...byName.values()].map(({ row, ids }) => ({ ...row, id: ids.join(',') }))
  }

  return {
    actor,
    projectId: undefined as string | undefined,
    formConfig: undefined,
    statuses: dedupe(statuses),
    priorities: dedupe(priorities),
    types: dedupe(types),
    labels: dedupe(labels),
    members,
    can: {
      // Cross-project views are read-and-edit only; creation needs a project,
      // which the user picks from within a project or the command palette.
      createTicket: false,
      updateTicket: true,
      deleteTicket: can(actor, 'ticket:delete'),
    },
  }
}

export type WorkspaceViewContext = Awaited<ReturnType<typeof getWorkspaceViewContext>>
