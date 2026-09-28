import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { agentComment, agentUserId } from '@/features/agents/service'
import { allocateTicketNumber } from '@/features/projects/service'
import { buildTicketKey, isTerminal } from '@/core/domain/ticket-rules'
import { fingerprintOf, type ErrorEvent } from '@/core/domain/error-events'

/**
 * Production errors into tickets, by the Triage agent.
 *
 * New error → a Production ticket, with the stack, how often it has happened,
 * and the changes most likely to have caused it. The same error again → the
 * count goes up, and a comment marks each order of magnitude. An error that
 * comes back after its ticket was closed → a regression: said so on the ticket,
 * and the ticket reopened, because "fixed" was evidently wrong.
 */

/** New tickets per project per hour — a storm files twenty, then waits. */
const NEW_TICKETS_PER_HOUR = 20
const MILESTONES = new Set([10, 100, 1000, 10000])

export function hashIngestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A fresh ingest secret for a project. Only the hash is stored. */
export async function rotateIngestToken(projectId: string): Promise<string> {
  const token = `tfe_${randomBytes(24).toString('base64url')}`
  await prisma.projectSettings.update({ where: { projectId }, data: { errorIngestHash: hashIngestToken(token) } })
  return token
}

export async function projectForToken(token: string) {
  if (!token.startsWith('tfe_') || token.length < 20) return null
  return prisma.projectSettings.findUnique({
    where: { errorIngestHash: hashIngestToken(token) },
    select: { projectId: true },
  })
}

export async function ingestError(projectId: string, event: ErrorEvent) {
  const fingerprint = fingerprintOf(event)
  const detail = [
    `**${event.level.toUpperCase()}** ${event.message}`,
    event.environment ? `Environment: ${event.environment}` : null,
    event.release ? `Release: \`${event.release}\`` : null,
    event.url ? `Details: ${event.url}` : null,
    event.stack ? `\n\`\`\`\n${event.stack}\n\`\`\`` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const existing = await prisma.errorGroup.findUnique({
    where: { projectId_fingerprint: { projectId, fingerprint } },
    select: {
      id: true,
      count: true,
      ticket: { select: { id: true, key: true, status: { select: { category: true, name: true } } } },
    },
  })

  if (existing) {
    const group = await prisma.errorGroup.update({
      where: { id: existing.id },
      data: { count: { increment: 1 }, lastSeen: new Date(), lastDetail: detail, environment: event.environment },
      select: { count: true },
    })
    const ticket = existing.ticket
    if (!ticket) return { ticketKey: null, created: false, count: group.count }

    if (isTerminal(ticket.status.category)) {
      await reopenAsRegression(ticket.id, projectId, ticket.key, ticket.status.name, group.count, detail)
      return { ticketKey: ticket.key, created: false, regression: true, count: group.count }
    }
    if (MILESTONES.has(group.count)) {
      await agentComment('triage', ticket.id, `Seen **${group.count.toLocaleString()} times** now. Latest:\n\n${detail}`)
    }
    return { ticketKey: ticket.key, created: false, count: group.count }
  }

  const recent = await prisma.errorGroup.count({
    where: { projectId, firstSeen: { gt: new Date(Date.now() - 3_600_000) }, ticketId: { not: null } },
  })
  const fileTicket = recent < NEW_TICKETS_PER_HOUR

  const suspects = await suspectChanges(projectId, event.release)
  const triage = await agentUserId('triage')

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        code: true,
        statuses: { where: { isInitial: true }, select: { id: true }, take: 1 },
        priorities: { orderBy: { level: 'desc' }, select: { id: true, level: true, isDefault: true } },
        ticketTypes: { select: { id: true, kind: true, isDefault: true } },
      },
    })

    let ticket: { id: string; key: string } | null = null
    if (fileTicket) {
      const status = project.statuses[0] ?? (await tx.status.findFirstOrThrow({ where: { projectId }, orderBy: { position: 'asc' } }))
      const type =
        project.ticketTypes.find((entry) => entry.kind === 'PRODUCTION') ??
        project.ticketTypes.find((entry) => entry.kind === 'BUG') ??
        project.ticketTypes.find((entry) => entry.isDefault) ??
        project.ticketTypes[0]
      // Crashes go straight to the top; warnings take the project default.
      const priority =
        event.level === 'fatal' || event.level === 'error'
          ? project.priorities[0]
          : (project.priorities.find((entry) => entry.isDefault) ?? project.priorities[0])

      const number = await allocateTicketNumber(tx, projectId)
      const key = buildTicketKey(project.code, number)
      ticket = await tx.ticket.create({
        data: {
          number,
          key,
          projectId,
          title: `[${event.environment ?? 'production'}] ${event.title}`.slice(0, 200),
          description: [
            detail,
            suspects.length
              ? `\n**Suspect changes** — shipped in the deployment this error was reported against:\n${suspects.map((entry) => `- ${entry}`).join('\n')}`
              : null,
            '\n_Filed automatically from a production error report. Repeats are counted here rather than filed again._',
          ]
            .filter(Boolean)
            .join('\n'),
          statusId: status.id,
          priorityId: priority.id,
          typeId: type.id,
          reporterId: triage,
          createdById: triage,
        },
        select: { id: true, key: true },
      })
      await recordActivity(tx, {
        action: 'CREATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        entityLabel: key,
        projectId,
        ticketId: ticket.id,
        actorId: triage,
        summary: `filed ${key} from a production error`,
      })
    }

    await tx.errorGroup.create({
      data: {
        projectId,
        fingerprint,
        title: event.title,
        lastDetail: detail,
        environment: event.environment,
        ticketId: ticket?.id ?? null,
      },
    })
    return ticket
  })

  return { ticketKey: created?.key ?? null, created: Boolean(created), count: 1, throttled: !fileTicket }
}

async function reopenAsRegression(
  ticketId: string,
  projectId: string,
  key: string,
  statusName: string,
  count: number,
  detail: string,
) {
  const triage = await agentUserId('triage')
  const initial = await prisma.status.findFirst({
    where: { projectId, isInitial: true },
    select: { id: true, name: true },
  })
  if (!initial) return
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticketId }, data: { statusId: initial.id, completedAt: null } })
    await recordActivity(tx, {
      action: 'STATUS_CHANGED',
      entityType: 'TICKET',
      entityId: ticketId,
      entityLabel: key,
      projectId,
      ticketId,
      actorId: triage,
      field: 'status',
      oldValue: statusName,
      newValue: initial.name,
      summary: `reopened ${key}: the error it was filed for happened again`,
    })
  })
  await agentComment(
    'triage',
    ticketId,
    `🔁 **Regression.** This error happened again after the ticket was closed (${count.toLocaleString()} times in all), so it has been reopened.\n\n${detail}`,
  )
}

/**
 * The tickets shipped in the deployment the error names — or, when it names
 * none, in the most recent successful production deployment, which is where
 * a new error most often comes from.
 */
async function suspectChanges(projectId: string, release: string | null): Promise<string[]> {
  const repos = await prisma.projectRepo.findMany({ where: { projectId }, select: { repoId: true } })
  if (repos.length === 0) return []
  const repoIds = repos.map((entry) => entry.repoId)

  const deployment =
    (release
      ? await prisma.deployment.findFirst({
          where: { repoId: { in: repoIds }, sha: { startsWith: release.slice(0, 40) } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, sha: true, environment: true },
        })
      : null) ??
    (await prisma.deployment.findFirst({
      where: { repoId: { in: repoIds }, isProduction: true, state: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sha: true, environment: true },
    }))
  if (!deployment) return []

  const shipped = await prisma.ticketDeployment.findMany({
    where: { deploymentId: deployment.id, ticket: { projectId } },
    select: { ticket: { select: { key: true, title: true, assignee: { select: { name: true } } } } },
    take: 10,
  })
  return shipped.map(
    ({ ticket }) =>
      `${ticket.key} ${ticket.title}${ticket.assignee ? ` (${ticket.assignee.name})` : ''} — ${deployment.environment} ${deployment.sha.slice(0, 7)}`,
  )
}
