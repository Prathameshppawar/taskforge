/* eslint-disable no-console */
import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

import { buildTicketKey } from '../src/core/domain/ticket-rules'

/**
 * Demo workspace.
 *
 * Opt-in via SEED_DEMO=true. Creates a team, two projects instantiated from the
 * built-in templates, a realistic spread of tickets across statuses, comments,
 * resources, a recurring schedule and matching audit entries — enough to
 * exercise every view (board, table, calendar, timeline, dashboards).
 */

const DEMO_USERS = [
  { username: 'rhea.kapoor',  name: 'Rhea Kapoor',  role: 'PROJECT_MANAGER', title: 'Engineering Manager', color: 'violet' },
  { username: 'arjun.mehta',  name: 'Arjun Mehta',  role: 'USER',            title: 'Backend Engineer',    color: 'emerald' },
  { username: 'sana.iyer',    name: 'Sana Iyer',    role: 'USER',            title: 'Frontend Engineer',   color: 'blue' },
  { username: 'daniel.okoro', name: 'Daniel Okoro', role: 'USER',            title: 'QA Engineer',         color: 'amber' },
  { username: 'mei.lin',      name: 'Mei Lin',      role: 'USER',            title: 'Platform Engineer',   color: 'cyan' },
] as const

function daysFromNow(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(17, 0, 0, 0)
  return date
}

export async function seedDemo(prisma: PrismaClient, adminId: string) {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12)
  const demoHash = await bcrypt.hash('Demo!2024', rounds)

  // --- team ------------------------------------------------------------------
  const roleByKey = Object.fromEntries(
    (await prisma.role.findMany()).map((r) => [r.key, r.id]),
  ) as Record<string, string>

  const users: Record<string, string> = {}
  for (const seed of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { username: seed.username },
      update: {},
      create: {
        username: seed.username,
        email: `${seed.username}@taskforge.local`,
        name: seed.name,
        jobTitle: seed.title,
        passwordHash: demoHash,
        roleId: roleByKey[seed.role],
        avatarColor: seed.color,
        createdById: adminId,
      },
    })
    users[seed.username] = user.id
  }
  console.log(`  ✓ ${DEMO_USERS.length} demo users (password: Demo!2024)`)

  // --- projects --------------------------------------------------------------
  await prisma.project.deleteMany({ where: { code: { in: ['ATLAS', 'PAY'] } } })

  const atlas = await instantiateProject(prisma, {
    templateName: 'Full Stack Web App',
    name: 'Atlas Customer Portal',
    code: 'ATLAS',
    description:
      'Self-service portal where customers manage their subscription, invoices and support requests.',
    ownerId: users['rhea.kapoor'],
    createdById: adminId,
    color: 'indigo',
    startDate: daysFromNow(-45),
    endDate: daysFromNow(60),
    members: [
      { userId: users['rhea.kapoor'], role: 'MANAGER' as const },
      { userId: users['arjun.mehta'], role: 'MEMBER' as const },
      { userId: users['sana.iyer'], role: 'MEMBER' as const },
      { userId: users['daniel.okoro'], role: 'MEMBER' as const },
      { userId: adminId, role: 'MANAGER' as const },
    ],
  })

  const pay = await instantiateProject(prisma, {
    templateName: 'Backend API Project',
    name: 'Payments Service',
    code: 'PAY',
    description: 'Ledger, settlement and reconciliation API backing all customer billing.',
    ownerId: users['rhea.kapoor'],
    createdById: adminId,
    color: 'emerald',
    startDate: daysFromNow(-20),
    endDate: daysFromNow(90),
    members: [
      { userId: users['rhea.kapoor'], role: 'MANAGER' as const },
      { userId: users['arjun.mehta'], role: 'MEMBER' as const },
      { userId: users['mei.lin'], role: 'MEMBER' as const },
      { userId: adminId, role: 'MANAGER' as const },
    ],
  })

  console.log('  ✓ 2 demo projects instantiated from templates')

  // --- tickets ---------------------------------------------------------------
  const atlasCount = await populateTickets(prisma, atlas.id, adminId, [
    users['arjun.mehta'],
    users['sana.iyer'],
    users['daniel.okoro'],
    users['rhea.kapoor'],
  ])

  const payCount = await populateTickets(prisma, pay.id, adminId, [
    users['arjun.mehta'],
    users['mei.lin'],
    users['rhea.kapoor'],
  ])

  console.log(`  ✓ ${atlasCount + payCount} demo tickets with comments, resources and history`)

  // --- recurring schedule ----------------------------------------------------
  const payConfig = await loadConfig(prisma, pay.id)
  await prisma.recurringTicket.create({
    data: {
      projectId: pay.id,
      name: 'Weekly backup validation',
      title: 'Validate database backups',
      description:
        'Restore the most recent nightly backup into the staging cluster and verify row counts against production.',
      statusId: payConfig.initialStatusId,
      priorityId: payConfig.priorityByName['High'],
      typeId: payConfig.typeByName['Task'],
      assigneeId: users['mei.lin'],
      frequency: 'WEEKLY',
      interval: 1,
      dayOfWeek: 1,
      dueInDays: 2,
      startDate: daysFromNow(-7),
      nextRunAt: daysFromNow(1),
      createdById: adminId,
      labels: {
        create: payConfig.labelByName['DevOps']
          ? [{ labelId: payConfig.labelByName['DevOps'] }]
          : [],
      },
    },
  })

  await prisma.recurringTicket.create({
    data: {
      projectId: pay.id,
      name: 'Monthly access review',
      title: 'Review production access list',
      description: 'Confirm every account with production access still requires it.',
      statusId: payConfig.initialStatusId,
      priorityId: payConfig.priorityByName['Critical'],
      typeId: payConfig.typeByName['Task'],
      assigneeId: users['rhea.kapoor'],
      frequency: 'MONTHLY',
      interval: 1,
      dayOfMonth: 1,
      dueInDays: 5,
      startDate: daysFromNow(-30),
      nextRunAt: daysFromNow(3),
      createdById: adminId,
      labels: {
        create: payConfig.labelByName['Security']
          ? [{ labelId: payConfig.labelByName['Security'] }]
          : [],
      },
    },
  })
  console.log('  ✓ 2 recurring schedules')

  // --- saved filter ----------------------------------------------------------
  // Upsert, not create: SavedFilter is unique on (ownerId, name), so a second
  // run of the demo seed would otherwise fail with P2002 after having already
  // recreated the projects — leaving the workspace half-seeded.
  await prisma.savedFilter.upsert({
    where: { ownerId_name: { ownerId: adminId, name: 'My Critical Bugs' } },
    update: {
      isShared: true,
      isPinned: true,
      viewType: 'TABLE',
      sortBy: 'dueDate',
      sortDir: 'asc',
      criteria: {
        deleteMany: {},
        createMany: {
          data: [
            { field: 'ASSIGNEE', operator: 'EQUALS', value: '@me', position: 0 },
            { field: 'TYPE', operator: 'EQUALS', value: 'Bug', position: 1 },
            { field: 'PRIORITY', operator: 'IN', value: 'Critical', position: 2 },
            { field: 'PRIORITY', operator: 'IN', value: 'Blocker', position: 3 },
          ],
        },
      },
    },
    create: {
      name: 'My Critical Bugs',
      ownerId: adminId,
      isShared: true,
      isPinned: true,
      viewType: 'TABLE',
      sortBy: 'dueDate',
      sortDir: 'asc',
      criteria: {
        create: [
          { field: 'ASSIGNEE', operator: 'EQUALS', value: '@me', position: 0 },
          { field: 'TYPE', operator: 'EQUALS', value: 'Bug', position: 1 },
          { field: 'PRIORITY', operator: 'IN', value: 'Critical', position: 2 },
          { field: 'PRIORITY', operator: 'IN', value: 'Blocker', position: 3 },
        ],
      },
    },
  })
  console.log('  ✓ 1 shared saved filter')
}

// -----------------------------------------------------------------------------

interface InstantiateArgs {
  templateName: string
  name: string
  code: string
  description: string
  ownerId: string
  createdById: string
  color: string
  startDate: Date
  endDate: Date
  members: Array<{ userId: string; role: 'MANAGER' | 'MEMBER' | 'VIEWER' }>
}

/**
 * Clones a template's workflow into a new project. This mirrors what the
 * "Create from Template" action does at runtime.
 */
async function instantiateProject(prisma: PrismaClient, args: InstantiateArgs) {
  const template = await prisma.projectTemplate.findUniqueOrThrow({
    where: { name: args.templateName },
    include: {
      statuses: { orderBy: { position: 'asc' } },
      priorities: { orderBy: { level: 'asc' } },
      types: { orderBy: { position: 'asc' } },
      labels: true,
      tickets: { orderBy: { position: 'asc' }, include: { labelNames: true } },
    },
  })

  const project = await prisma.project.create({
    data: {
      name: args.name,
      code: args.code,
      description: args.description,
      status: 'ACTIVE',
      startDate: args.startDate,
      endDate: args.endDate,
      ownerId: args.ownerId,
      createdById: args.createdById,
      templateId: template.id,
      settings: { create: { color: args.color, icon: template.icon } },
      members: {
        create: args.members.map((m) => ({
          userId: m.userId,
          role: m.role,
          addedById: args.createdById,
        })),
      },
      statuses: {
        create: template.statuses.map((s) => ({
          name: s.name,
          category: s.category,
          color: s.color,
          position: s.position,
          isInitial: s.isInitial,
        })),
      },
      priorities: {
        create: template.priorities.map((p) => ({
          name: p.name,
          color: p.color,
          level: p.level,
          isDefault: p.isDefault,
        })),
      },
      ticketTypes: {
        create: template.types.map((t) => ({
          name: t.name,
          color: t.color,
          icon: t.icon,
          position: t.position,
          isDefault: t.isDefault,
        })),
      },
      labels: {
        create: template.labels.map((l) => ({
          name: l.name,
          color: l.color,
          description: l.description,
        })),
      },
    },
  })

  // Materialize the template's default parent/child ticket scaffold.
  const config = await loadConfig(prisma, project.id)
  const roots = template.tickets.filter((t) => t.parentId === null)

  let number = 1
  for (const root of roots) {
    const parent = await prisma.ticket.create({
      data: {
        projectId: project.id,
        number,
        key: buildTicketKey(project.code, number),
        title: root.title,
        description: root.description,
        statusId: config.initialStatusId,
        priorityId: config.priorityByName[root.priorityName ?? 'Medium'] ?? config.defaultPriorityId,
        typeId: config.typeByName[root.typeName ?? 'Task'] ?? config.defaultTypeId,
        reporterId: args.ownerId,
        createdById: args.createdById,
        position: number * 1000,
        labels: {
          create: root.labelNames
            .filter((l) => config.labelByName[l.labelName])
            .map((l) => ({ labelId: config.labelByName[l.labelName] })),
        },
      },
    })
    number++

    const children = template.tickets.filter((t) => t.parentId === root.id)
    for (const child of children) {
      await prisma.ticket.create({
        data: {
          projectId: project.id,
          number,
          key: buildTicketKey(project.code, number),
          title: child.title,
          description: child.description,
          statusId: config.initialStatusId,
          priorityId:
            config.priorityByName[child.priorityName ?? 'Medium'] ?? config.defaultPriorityId,
          typeId: config.typeByName[child.typeName ?? 'Task'] ?? config.defaultTypeId,
          parentId: parent.id,
          reporterId: args.ownerId,
          createdById: args.createdById,
          position: number * 1000,
          labels: {
            create: child.labelNames
              .filter((l) => config.labelByName[l.labelName])
              .map((l) => ({ labelId: config.labelByName[l.labelName] })),
          },
        },
      })
      number++
    }
  }

  await prisma.projectSettings.update({
    where: { projectId: project.id },
    data: { nextTicketNumber: number },
  })

  return project
}

async function loadConfig(prisma: PrismaClient, projectId: string) {
  const [statuses, priorities, types, labels] = await Promise.all([
    prisma.status.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
    prisma.priority.findMany({ where: { projectId } }),
    prisma.ticketType.findMany({ where: { projectId } }),
    prisma.label.findMany({ where: { projectId } }),
  ])

  return {
    statuses,
    statusByName: Object.fromEntries(statuses.map((s) => [s.name, s.id])),
    initialStatusId: (statuses.find((s) => s.isInitial) ?? statuses[0]).id,
    priorityByName: Object.fromEntries(priorities.map((p) => [p.name, p.id])),
    defaultPriorityId: (priorities.find((p) => p.isDefault) ?? priorities[0]).id,
    typeByName: Object.fromEntries(types.map((t) => [t.name, t.id])),
    defaultTypeId: (types.find((t) => t.isDefault) ?? types[0]).id,
    labelByName: Object.fromEntries(labels.map((l) => [l.name, l.id])),
  }
}

/**
 * Spreads the scaffolded tickets across the workflow so every view has
 * something meaningful to render, then adds comments, resources and history.
 */
async function populateTickets(
  prisma: PrismaClient,
  projectId: string,
  adminId: string,
  assignees: string[],
): Promise<number> {
  const config = await loadConfig(prisma, projectId)
  const tickets = await prisma.ticket.findMany({
    where: { projectId },
    orderBy: { number: 'asc' },
    select: { id: true, key: true, title: true, parentId: true, number: true },
  })

  const workflow = config.statuses
  const doneStatus = workflow.find((s) => s.category === 'DONE')!
  const progressStatus = workflow.find((s) => s.category === 'IN_PROGRESS')!
  const blockedStatus = workflow.find((s) => s.category === 'BLOCKED')!
  const reviewStatus = workflow.find((s) => s.category === 'REVIEW')!
  const backlogStatus = workflow.find((s) => s.category === 'BACKLOG')!

  // Deterministic spread so re-seeding yields the same board.
  const distribution = [
    doneStatus, doneStatus, doneStatus,
    progressStatus, progressStatus,
    reviewStatus,
    blockedStatus,
    backlogStatus,
  ]

  for (const [index, ticket] of tickets.entries()) {
    const status = distribution[index % distribution.length]
    const assigneeId = assignees[index % assignees.length]
    const isDone = status.category === 'DONE'

    // A spread of due dates: some past (overdue), some imminent, some ahead.
    const dueOffset = [-6, -2, 3, 7, 14, 21, 30][index % 7]

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        statusId: status.id,
        assigneeId,
        dueDate: daysFromNow(dueOffset),
        startDate: daysFromNow(dueOffset - 10),
        completedAt: isDone ? daysFromNow(-1) : null,
        storyPoints: [1, 2, 3, 5, 8][index % 5],
        estimateHours: [2, 4, 8, 16][index % 4],
      },
    })

    await prisma.activityLog.createMany({
      data: [
        {
          action: 'CREATED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId,
          ticketId: ticket.id,
          actorId: adminId,
          summary: `created ${ticket.key}`,
        },
        {
          action: 'ASSIGNED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId,
          ticketId: ticket.id,
          actorId: adminId,
          field: 'assignee',
          newValue: assigneeId,
          summary: `assigned ${ticket.key}`,
        },
        {
          action: 'STATUS_CHANGED',
          entityType: 'TICKET',
          entityId: ticket.id,
          entityLabel: ticket.key,
          projectId,
          ticketId: ticket.id,
          actorId: assigneeId,
          field: 'status',
          oldValue: 'Open',
          newValue: status.name,
          summary: `moved ${ticket.key} to ${status.name}`,
        },
      ],
    })

    // Comments and resources on a subset, so threads look natural rather than
    // uniform.
    if (index % 3 === 0) {
      const root = await prisma.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: assigneeId,
          body: `Picked this up. Starting with the ${ticket.title.toLowerCase()} groundwork — will raise a PR once the happy path is covered.`,
        },
      })

      await prisma.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: adminId,
          parentId: root.id,
          body: 'Sounds good. Please make sure the error states are covered too.',
        },
      })

      await prisma.activityLog.create({
        data: {
          action: 'COMMENTED',
          entityType: 'COMMENT',
          entityId: root.id,
          entityLabel: ticket.key,
          projectId,
          ticketId: ticket.id,
          actorId: assigneeId,
          summary: `commented on ${ticket.key}`,
        },
      })
    }

    if (index % 4 === 0) {
      await prisma.ticketResource.createMany({
        data: [
          {
            ticketId: ticket.id,
            name: 'Implementation branch',
            type: 'GITHUB',
            url: `https://github.com/example/${projectId.slice(0, 6)}/pull/${100 + index}`,
            notes: 'Pull request tracking this work.',
            createdById: assigneeId,
          },
          {
            ticketId: ticket.id,
            name: 'Design reference',
            type: 'FIGMA',
            url: 'https://figma.com/file/example/design-reference',
            createdById: adminId,
          },
        ],
      })
    }
  }

  return tickets.length
}
