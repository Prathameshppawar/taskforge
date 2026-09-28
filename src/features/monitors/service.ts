import { lookup } from 'node:dns/promises'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { agentComment, agentUserId } from '@/features/agents/service'
import { allocateTicketNumber } from '@/features/projects/service'
import { buildTicketKey } from '@/core/domain/ticket-rules'
import { checkMonitorUrl, describeDuration, isPrivateAddress } from '@/core/domain/network'

/**
 * Uptime monitors and the incidents they open, run by TaskForge Ops.
 *
 * `runDueMonitors` is called every five minutes by a scheduler. A check that
 * fails `failureThreshold` times in a row opens a Production ticket — one per
 * outage, with every further failure kept off the ticket so it is not buried —
 * and recovery is written to that ticket with how long it was down.
 */

const TIMEOUT_MS = 10_000
const KEEP_CHECKS_MS = 7 * 86_400_000

interface CheckResult {
  ok: boolean
  status: number | null
  latencyMs: number | null
  error: string | null
}

export async function checkUrl(raw: string, expectedStatus: number, keyword: string | null): Promise<CheckResult> {
  const checked = checkMonitorUrl(raw)
  if (!checked.ok) return { ok: false, status: null, latencyMs: null, error: checked.reason }

  // Re-resolved every time: the name may point somewhere private now.
  try {
    const addresses = await lookup(checked.url.hostname, { all: true })
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      return { ok: false, status: null, latencyMs: null, error: 'The host resolves to a private address, so it is not checked.' }
    }
  } catch {
    return { ok: false, status: null, latencyMs: null, error: 'The host name does not resolve.' }
  }

  const started = Date.now()
  try {
    const response = await fetch(checked.url, {
      method: 'GET',
      // Redirects are not followed: one could lead to a private address the
      // check above never saw. A redirect is judged by its own status.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'TaskForge-Uptime/1.0' },
      cache: 'no-store',
    })
    const latencyMs = Date.now() - started
    if (response.status !== expectedStatus) {
      return { ok: false, status: response.status, latencyMs, error: `Expected ${expectedStatus}, got ${response.status}.` }
    }
    if (keyword) {
      const body = (await response.text()).slice(0, 500_000)
      if (!body.includes(keyword)) return { ok: false, status: response.status, latencyMs, error: `The page does not contain "${keyword}".` }
    }
    return { ok: true, status: response.status, latencyMs, error: null }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: timedOut ? `No response within ${TIMEOUT_MS / 1000}s.` : 'The connection failed.',
    }
  }
}

export async function runDueMonitors(now = new Date()) {
  const monitors = await prisma.monitor.findMany({ where: { isActive: true } })
  const due = monitors.filter(
    (monitor) => !monitor.lastCheckedAt || now.getTime() - monitor.lastCheckedAt.getTime() >= monitor.intervalMinutes * 60_000 - 30_000,
  )

  const results = await Promise.all(due.map((monitor) => runOne(monitor.id)))
  await prisma.monitorCheck.deleteMany({ where: { checkedAt: { lt: new Date(now.getTime() - KEEP_CHECKS_MS) } } })
  return { checked: due.length, down: results.filter((result) => result === 'down').length }
}

export async function runOne(monitorId: string): Promise<'up' | 'down'> {
  const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: monitorId } })
  const result = await checkUrl(monitor.url, monitor.expectedStatus, monitor.keyword)
  const now = new Date()

  await prisma.monitorCheck.create({
    data: { monitorId, ok: result.ok, status: result.status, latencyMs: result.latencyMs, error: result.error, checkedAt: now },
  })

  if (result.ok) {
    const wasDown = monitor.state === 'DOWN'
    await prisma.monitor.update({
      where: { id: monitorId },
      data: {
        state: 'UP',
        lastCheckedAt: now,
        lastLatencyMs: result.latencyMs,
        lastError: null,
        consecutiveFailures: 0,
        downSince: null,
        incidentTicketId: null,
      },
    })
    if (wasDown && monitor.incidentTicketId) {
      const lasted = monitor.downSince ? describeDuration(now.getTime() - monitor.downSince.getTime()) : 'an unknown time'
      await agentComment(
        'ops',
        monitor.incidentTicketId,
        `✅ **Recovered.** ${monitor.name} answered ${result.status} in ${result.latencyMs} ms. It was down for **${lasted}**. Draft a post-mortem from this ticket when the cause is known.`,
      )
    }
    return 'up'
  }

  const failures = monitor.consecutiveFailures + 1
  const downSince = monitor.downSince ?? now
  const crossing = failures >= monitor.failureThreshold && monitor.state !== 'DOWN'
  let incidentTicketId = monitor.incidentTicketId
  if (crossing) incidentTicketId = await openIncident(monitor, result, downSince)

  await prisma.monitor.update({
    where: { id: monitorId },
    data: {
      state: failures >= monitor.failureThreshold ? 'DOWN' : monitor.state,
      lastCheckedAt: now,
      lastLatencyMs: result.latencyMs,
      lastError: result.error,
      consecutiveFailures: failures,
      downSince,
      incidentTicketId,
    },
  })
  return 'down'
}

async function openIncident(
  monitor: { id: string; projectId: string; name: string; url: string; consecutiveFailures: number; failureThreshold: number },
  result: CheckResult,
  downSince: Date,
): Promise<string> {
  const ops = await agentUserId('ops')
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: monitor.projectId },
      select: {
        code: true,
        statuses: { where: { isInitial: true }, select: { id: true }, take: 1 },
        priorities: { orderBy: { level: 'desc' }, select: { id: true }, take: 1 },
        ticketTypes: { select: { id: true, kind: true, isDefault: true } },
      },
    })
    const status = project.statuses[0] ?? (await tx.status.findFirstOrThrow({ where: { projectId: monitor.projectId }, orderBy: { position: 'asc' } }))
    const type =
      project.ticketTypes.find((entry) => entry.kind === 'PRODUCTION') ??
      project.ticketTypes.find((entry) => entry.isDefault) ??
      project.ticketTypes[0]
    const number = await allocateTicketNumber(tx, monitor.projectId)
    const key = buildTicketKey(project.code, number)
    const ticket = await tx.ticket.create({
      data: {
        number,
        key,
        projectId: monitor.projectId,
        title: `Down: ${monitor.name}`,
        description: [
          `**${monitor.name}** (${monitor.url}) has failed ${monitor.failureThreshold} checks in a row.`,
          '',
          `- First failure: ${downSince.toISOString()}`,
          `- Last result: ${result.error ?? 'failed'}${result.status ? ` (HTTP ${result.status})` : ''}`,
          '',
          '_Opened automatically by TaskForge Ops. Recovery will be posted here with how long the outage lasted._',
        ].join('\n'),
        statusId: status.id,
        priorityId: project.priorities[0].id,
        typeId: type.id,
        reporterId: ops,
        createdById: ops,
      },
      select: { id: true },
    })
    await recordActivity(tx, {
      action: 'CREATED',
      entityType: 'TICKET',
      entityId: ticket.id,
      entityLabel: key,
      projectId: monitor.projectId,
      ticketId: ticket.id,
      actorId: ops,
      summary: `opened incident ${key}: ${monitor.name} is down`,
    })
    return ticket.id
  })
}
