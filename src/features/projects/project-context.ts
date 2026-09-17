import { prisma } from '@/infrastructure/db/prisma'
import { canInProject } from '@/core/domain/rbac'
import { requireProjectView } from '@/features/auth/guards'
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
