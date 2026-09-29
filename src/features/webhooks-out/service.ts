import { createHmac, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'

import { prisma } from '@/infrastructure/db/prisma'
import { seal, unseal } from '@/infrastructure/github/secrets'
import { enqueue } from '@/features/jobs/queue'
import { appUrl } from '@/features/notifications/email'
import { checkMonitorUrl, isPrivateAddress } from '@/core/domain/network'

/**
 * Outbound webhooks: other systems told when tickets change.
 *
 * Events are read from the histories the database already keeps — status
 * changes (a ticket's first row is its creation) and comments — rather than
 * emitted from each write path, so no path can forget to. The five-minute cron
 * reads what is new since the last cursor and queues one delivery per event
 * per subscribed endpoint; the queue retries with backoff. Each body is signed
 * with HMAC-SHA256 under the endpoint's secret, the way GitHub signs its own.
 */

export const EVENTS = ['ticket.created', 'ticket.status_changed', 'ticket.completed', 'comment.created'] as const
export type WebhookEvent = (typeof EVENTS)[number]

export function newSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

export function sealSecret(secret: string) {
  return seal(secret)
}

export function signature(secret: string, body: string) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

export async function sweepOutbox(now = new Date()): Promise<{ queued: number }> {
  const hooks = await prisma.outboundWebhook.findMany({ where: { active: true }, select: { id: true, events: true, projectId: true } })
  const cursor = await prisma.outboxCursor.upsert({ where: { id: 1 }, create: { id: 1, statusChangesAt: now, commentsAt: now }, update: {} })
  if (hooks.length === 0) {
    // Nobody is listening: move on, so a first webhook does not replay history.
    await prisma.outboxCursor.update({ where: { id: 1 }, data: { statusChangesAt: now, commentsAt: now } })
    return { queued: 0 }
  }

  const [changes, comments] = await Promise.all([
    prisma.ticketStatusChange.findMany({
      where: { changedAt: { gt: cursor.statusChangesAt, lte: now } },
      orderBy: { changedAt: 'asc' },
      take: 500,
      select: {
        id: true,
        changedAt: true,
        fromCategory: true,
        toCategory: true,
        toStatusId: true,
        ticket: { select: { id: true, key: true, title: true, projectId: true, project: { select: { code: true } }, status: { select: { name: true } } } },
      },
    }),
    prisma.comment.findMany({
      where: { createdAt: { gt: cursor.commentsAt, lte: now }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, body: true, createdAt: true, author: { select: { name: true, username: true } }, ticket: { select: { key: true, title: true, projectId: true } } },
    }),
  ])

  const events: Array<{ event: WebhookEvent; sourceId: string; projectId: string; data: Record<string, unknown> }> = []
  for (const change of changes) {
    const ticket = { key: change.ticket.key, title: change.ticket.title, project: change.ticket.project.code, url: `${appUrl()}/tickets/${change.ticket.key}` }
    if (change.fromCategory === null) events.push({ event: 'ticket.created', sourceId: change.id, projectId: change.ticket.projectId, data: { ticket, status: change.ticket.status.name } })
    else {
      events.push({ event: 'ticket.status_changed', sourceId: change.id, projectId: change.ticket.projectId, data: { ticket, from: change.fromCategory, to: change.toCategory, changedAt: change.changedAt } })
      if (change.toCategory === 'DONE') events.push({ event: 'ticket.completed', sourceId: change.id, projectId: change.ticket.projectId, data: { ticket, completedAt: change.changedAt } })
    }
  }
  for (const comment of comments) {
    events.push({
      event: 'comment.created',
      sourceId: comment.id,
      projectId: comment.ticket.projectId,
      data: { ticket: { key: comment.ticket.key, title: comment.ticket.title, url: `${appUrl()}/tickets/${comment.ticket.key}` }, author: comment.author, body: comment.body.slice(0, 5000), createdAt: comment.createdAt },
    })
  }

  let queued = 0
  for (const event of events) {
    for (const hook of hooks) {
      if (!hook.events.includes(event.event) || (hook.projectId && hook.projectId !== event.projectId)) continue
      await enqueue('webhook.deliver', { webhookId: hook.id, event: event.event, data: event.data }, { dedupeKey: `wh:${hook.id}:${event.event}:${event.sourceId}`, maxAttempts: 6, drainSoon: false })
      queued++
    }
  }

  // Advance only as far as what was read, so a busy five minutes is finished next time.
  await prisma.outboxCursor.update({
    where: { id: 1 },
    data: {
      statusChangesAt: changes.length === 500 ? changes.at(-1)!.changedAt : now,
      commentsAt: comments.length === 500 ? comments.at(-1)!.createdAt : now,
    },
  })
  return { queued }
}

/** Refuses private and local addresses, so a webhook cannot probe the network TaskForge runs in. */
async function assertPublic(url: string) {
  const checked = checkMonitorUrl(url)
  if (!checked.ok) throw new Error(checked.reason)
  const addresses = await lookup(checked.url.hostname, { all: true })
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('That address resolves to a private network.')
  return checked.url
}

export async function deliver(webhookId: string, event: string, data: Record<string, unknown>): Promise<number> {
  const hook = await prisma.outboundWebhook.findUnique({ where: { id: webhookId } })
  if (!hook || !hook.active) return 0
  const body = JSON.stringify({ event, deliveredAt: new Date().toISOString(), data })
  try {
    const url = await assertPublic(hook.url)
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TaskForge-Webhooks/1.0',
        'X-TaskForge-Event': event,
        'X-TaskForge-Signature': signature(unseal(hook.secretEnc), body),
      },
      body,
    })
    await prisma.outboundWebhook.update({
      where: { id: hook.id },
      data: { lastStatus: response.status, lastError: response.ok ? null : `HTTP ${response.status}`, lastDeliveredAt: new Date() },
    })
    if (!response.ok) throw new Error(`The endpoint answered ${response.status}.`)
    return response.status
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.outboundWebhook.update({ where: { id: hook.id }, data: { lastError: message.slice(0, 300), lastDeliveredAt: new Date() } }).catch(() => undefined)
    throw error
  }
}

export async function deliverJob(payload: Record<string, unknown>) {
  await deliver(String(payload.webhookId), String(payload.event), (payload.data ?? {}) as Record<string, unknown>)
}
