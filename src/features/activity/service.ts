import type { ActivityAction, ActivityEntity, Prisma, PrismaClient } from '@prisma/client'

/**
 * Audit trail writer.
 *
 * Every entry is written INSIDE the same transaction as the change it records,
 * so the timeline can never drift from the data. Callers pass the transaction
 * client; there is deliberately no variant that writes outside one.
 */
export type TxClient = Prisma.TransactionClient | PrismaClient

export interface ActivityInput {
  action: ActivityAction
  entityType: ActivityEntity
  entityId: string
  /** Snapshot of the subject's name, so the log survives renames and deletes. */
  entityLabel?: string | null
  projectId?: string | null
  ticketId?: string | null
  actorId?: string | null
  field?: string | null
  oldValue?: string | null
  newValue?: string | null
  summary?: string | null
}

export async function recordActivity(tx: TxClient, input: ActivityInput): Promise<void> {
  await tx.activityLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel ?? null,
      projectId: input.projectId ?? null,
      ticketId: input.ticketId ?? null,
      actorId: input.actorId ?? null,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      summary: input.summary ?? null,
    },
  })
}

export async function recordActivities(tx: TxClient, inputs: ActivityInput[]): Promise<void> {
  if (inputs.length === 0) return
  await tx.activityLog.createMany({
    data: inputs.map((input) => ({
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel ?? null,
      projectId: input.projectId ?? null,
      ticketId: input.ticketId ?? null,
      actorId: input.actorId ?? null,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      summary: input.summary ?? null,
    })),
  })
}

/**
 * Builds one activity row per changed field by diffing two snapshots.
 * Used by update actions so field-level history is automatic.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  labels: Partial<Record<keyof T, string>> = {},
): Array<{ field: string; oldValue: string | null; newValue: string | null }> {
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

  for (const key of Object.keys(after) as Array<keyof T>) {
    const nextValue = after[key]
    if (nextValue === undefined) continue

    const prevValue = before[key]
    if (normalize(prevValue) === normalize(nextValue)) continue

    changes.push({
      field: (labels[key] as string | undefined) ?? String(key),
      oldValue: normalize(prevValue),
      newValue: normalize(nextValue),
    })
  }

  return changes
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}
