import { after } from 'next/server'
import { Prisma } from '@prisma/client'

import { prisma } from '@/infrastructure/db/prisma'
import { nextAttemptAt, STALE_LOCK_MS } from '@/core/domain/jobs'

/**
 * The background queue (see the Job model). `enqueue` inside a request also
 * schedules a drain for once the response is sent, so work usually starts
 * within a second; the cron picks up whatever that misses.
 */

export type JobKind = 'webhook.deliver' | 'triage.ticket' | 'memory.index' | 'handbook.generate'

type Handler = (payload: Record<string, unknown>) => Promise<void>

/** Handlers, imported when first needed so the queue has no import cycles. */
const HANDLERS: Record<JobKind, () => Promise<Handler>> = {
  'webhook.deliver': async () => (await import('@/features/webhooks-out/service')).deliverJob,
  'triage.ticket': async () => (await import('@/features/triage-agent/service')).triageJob,
  'memory.index': async () => (await import('@/features/memory/index-service')).indexJob,
  'handbook.generate': async () => (await import('@/features/memory/handbook')).handbookJob,
}

export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown>,
  options: { runAt?: Date; dedupeKey?: string; maxAttempts?: number; drainSoon?: boolean } = {},
): Promise<void> {
  try {
    await prisma.job.create({
      data: {
        kind,
        payload: payload as Prisma.InputJsonValue,
        runAt: options.runAt ?? new Date(),
        dedupeKey: options.dedupeKey ?? null,
        maxAttempts: options.maxAttempts ?? 5,
      },
    })
  } catch (error) {
    // Same dedupe key already queued: that job will do the work.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
    throw error
  }
  if (options.drainSoon !== false) drainLater()
}

function drainLater() {
  try {
    after(() => drain({ limit: 5, budgetMs: 20_000 }).catch((error) => console.error('[jobs] drain failed:', error)))
  } catch {
    // Outside a request: the cron will drain it.
  }
}

interface Claimed {
  id: string
  kind: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

/** Takes up to `limit` due jobs, runs them, and records each outcome. */
export async function drain(options: { limit?: number; budgetMs?: number } = {}): Promise<{ ran: number; failed: number }> {
  const limit = options.limit ?? 20
  const deadline = Date.now() + (options.budgetMs ?? 40_000)
  const now = new Date()

  // Give back jobs a dead function was holding.
  await prisma.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    data: { status: 'PENDING', lockedAt: null },
  })

  const claimed = await prisma.$queryRaw<Claimed[]>`
    UPDATE "jobs" SET "status" = 'RUNNING', "lockedAt" = NOW() AT TIME ZONE 'UTC', "attempts" = "attempts" + 1, "updatedAt" = NOW() AT TIME ZONE 'UTC'
    WHERE "id" IN (
      SELECT "id" FROM "jobs"
      WHERE "status" = 'PENDING' AND "runAt" <= NOW() AT TIME ZONE 'UTC'
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "kind", "payload", "attempts", "maxAttempts"`

  let ran = 0
  let failed = 0
  for (const job of claimed) {
    if (Date.now() > deadline) {
      // Out of time: hand it back untouched for the next drain.
      await prisma.job.update({ where: { id: job.id }, data: { status: 'PENDING', lockedAt: null, attempts: { decrement: 1 } } })
      continue
    }
    try {
      const handler = await HANDLERS[job.kind as JobKind]?.()
      if (!handler) throw new Error(`No handler for ${job.kind}.`)
      await handler(job.payload)
      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', lockedAt: null, lastError: null, dedupeKey: null } })
      ran++
    } catch (error) {
      failed++
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
      const giveUp = job.attempts >= job.maxAttempts
      await prisma.job.update({
        where: { id: job.id },
        data: giveUp
          ? { status: 'FAILED', lockedAt: null, lastError: message, dedupeKey: null }
          : { status: 'PENDING', lockedAt: null, lastError: message, runAt: nextAttemptAt(job.attempts, new Date()) },
      })
    }
  }

  // Finished work is kept a week, then dropped: the free database is small.
  await prisma.job.deleteMany({ where: { status: 'DONE', updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } })
  return { ran, failed }
}

export async function queueSummary() {
  const [counts, failures] = await Promise.all([
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.job.findMany({ where: { status: 'FAILED' }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, kind: true, lastError: true, updatedAt: true, attempts: true } }),
  ])
  return { counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Record<string, number>, failures }
}

export async function retryFailed(id?: string) {
  await prisma.job.updateMany({ where: { status: 'FAILED', ...(id ? { id } : {}) }, data: { status: 'PENDING', attempts: 0, runAt: new Date(), lastError: null } })
  drainLater()
}
