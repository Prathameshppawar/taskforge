import type { CustomField, Prisma } from '@prisma/client'

import { BusinessRuleError } from '@/core/domain/errors'
import { normaliseFieldValue } from '@/core/domain/custom-fields'

type Tx = Prisma.TransactionClient

/**
 * Writes one normalised value, checking what the type alone cannot: a USER
 * value must be a member of the project. Returns the previous value, or null
 * when nothing changed.
 */
export async function writeFieldValue(
  tx: Tx,
  args: { ticketId: string; projectId: string; field: CustomField; value: string | null },
): Promise<{ before: string | null } | null> {
  if (args.field.type === 'USER' && args.value) {
    const member = await tx.projectMember.findFirst({ where: { projectId: args.projectId, userId: args.value }, select: { userId: true } })
    if (!member) throw new BusinessRuleError(`${args.field.name} must be someone on this project.`)
  }
  const existing = await tx.ticketFieldValue.findUnique({
    where: { ticketId_fieldId: { ticketId: args.ticketId, fieldId: args.field.id } },
    select: { value: true },
  })
  const before = existing?.value ?? null
  if (before === args.value) return null
  if (args.value === null) {
    await tx.ticketFieldValue.delete({ where: { ticketId_fieldId: { ticketId: args.ticketId, fieldId: args.field.id } } })
  } else {
    await tx.ticketFieldValue.upsert({
      where: { ticketId_fieldId: { ticketId: args.ticketId, fieldId: args.field.id } },
      create: { ticketId: args.ticketId, fieldId: args.field.id, value: args.value },
      update: { value: args.value },
    })
  }
  return { before }
}

/**
 * Values for a new ticket, keyed by field id. With `enforceRequired`, a
 * required field left empty is refused — the dialog asks for them; paths that
 * cannot ask (email, the Copilot) do not enforce it.
 */
export async function writeInitialFieldValues(
  tx: Tx,
  args: { ticketId: string; projectId: string; values: Record<string, unknown>; enforceRequired: boolean },
): Promise<void> {
  const fields = await tx.customField.findMany({ where: { projectId: args.projectId } })
  for (const field of fields) {
    const normalised = normaliseFieldValue(field, args.values[field.id])
    if (!normalised.ok) throw new BusinessRuleError(normalised.error)
    if (normalised.value === null) {
      if (args.enforceRequired && field.required) throw new BusinessRuleError(`${field.name} is required.`)
      continue
    }
    await writeFieldValue(tx, { ticketId: args.ticketId, projectId: args.projectId, field, value: normalised.value })
  }
}
