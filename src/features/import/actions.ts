'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission } from '@/features/auth/guards'
import { allocateTicketNumber, loadProjectConfig } from '@/features/projects/service'
import { addChecklistItems, applyParentRollup, validateParentAssignment } from '@/features/tickets/service'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { buildTicketKey, isTerminal } from '@/core/domain/ticket-rules'
import { runAction } from '@/lib/safe-action'

/**
 * Importing another tracker's tickets into a project.
 *
 * The file is parsed in the browser (core/domain/import.ts) and arrives here
 * in batches of normalised items, with the mappings the person confirmed.
 * Each ticket keeps its original key in `externalRef`, which makes a second
 * run skip what the first brought in and lets parents be linked once every
 * batch has landed. Imported tickets notify nobody: a thousand "assigned to
 * you" emails is not an import, it is an incident.
 */

const MAX_ITEMS = 200

const item = z.object({
  ref: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50_000).optional(),
  status: z.string().max(100).optional(),
  type: z.string().max(100).optional(),
  priority: z.string().max(100).optional(),
  assignee: z.string().max(200).optional(),
  reporter: z.string().max(200).optional(),
  labels: z.array(z.string().max(60)).max(20).default([]),
  dueDate: z.string().optional(),
  createdAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  storyPoints: z.number().int().min(0).max(999).optional(),
  parentRef: z.string().max(100).optional(),
  criteria: z.array(z.object({ text: z.string().max(300), done: z.boolean() })).max(30).default([]),
  comments: z.array(z.object({ author: z.string().max(200).optional(), at: z.string().optional(), body: z.string().max(20_000) })).max(100).default([]),
})

const input = z.object({
  projectId: z.string().min(1),
  source: z.enum(['jira', 'trello', 'csv']),
  items: z.array(item).min(1).max(MAX_ITEMS),
  statusMap: z.record(z.string(), z.string()),
  typeMap: z.record(z.string(), z.string()),
  priorityMap: z.record(z.string(), z.string()),
  /** Source person → user id, or "" to leave unassigned. */
  personMap: z.record(z.string(), z.string()),
})

function date(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function importBatchAction(raw: z.input<typeof input>): Promise<ActionResult<{ created: number; skipped: number }>> {
  return runAction(async () => {
    const data = input.parse(raw)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    const project = await prisma.project.findUnique({ where: { id: data.projectId }, select: { code: true, isArchived: true } })
    if (!project || project.isArchived) return fail('That project is archived or gone.')

    const refs = data.items.map((entry) => `${data.source}:${entry.ref}`)
    const existing = new Set(
      (await prisma.ticket.findMany({ where: { projectId: data.projectId, externalRef: { in: refs } }, select: { externalRef: true } })).map((row) => row.externalRef),
    )
    const members = new Set(
      (await prisma.projectMember.findMany({ where: { projectId: data.projectId }, select: { userId: true } })).map((row) => row.userId),
    )

    const result = await prisma.$transaction(
      async (tx) => {
        const config = await loadProjectConfig(tx, data.projectId)
        const labels = new Map(config.labels.map((label) => [label.name.toLowerCase(), label.id]))
        let created = 0
        for (const entry of data.items) {
          const externalRef = `${data.source}:${entry.ref}`
          if (existing.has(externalRef)) continue

          const statusId = (entry.status && data.statusMap[entry.status]) || config.initialStatus?.id
          const status = config.statuses.find((row) => row.id === statusId) ?? config.initialStatus
          const typeId = (entry.type && data.typeMap[entry.type]) || config.defaultType?.id
          const priorityId = (entry.priority && data.priorityMap[entry.priority]) || config.defaultPriority?.id
          if (!status || !typeId || !priorityId) throw new Error('This project has no workflow configured.')
          const person = (value?: string) => {
            const id = value ? data.personMap[value] : ''
            return id && members.has(id) ? id : null
          }
          const createdAt = date(entry.createdAt) ?? new Date()
          const number = await allocateTicketNumber(tx, data.projectId)
          const ticket = await tx.ticket.create({
            data: {
              projectId: data.projectId,
              number,
              key: buildTicketKey(project.code, number),
              title: entry.title.slice(0, 200),
              description: entry.description || null,
              remarks: `Imported from ${data.source === 'jira' ? 'Jira' : data.source === 'trello' ? 'Trello' : 'a spreadsheet'} (${entry.ref}).`,
              statusId: status.id,
              priorityId,
              typeId,
              assigneeId: person(entry.assignee),
              reporterId: person(entry.reporter) ?? actor.id,
              createdById: actor.id,
              dueDate: date(entry.dueDate),
              storyPoints: entry.storyPoints ?? null,
              createdAt,
              completedAt: isTerminal(status.category) ? (date(entry.resolvedAt) ?? createdAt) : null,
              position: number * 1000,
              externalRef,
            },
            select: { id: true },
          })

          if (entry.labels.length) {
            const ids: string[] = []
            for (const name of entry.labels) {
              let id = labels.get(name.toLowerCase())
              if (!id) {
                id = (await tx.label.create({ data: { projectId: data.projectId, name: name.slice(0, 40), color: 'slate' }, select: { id: true } })).id
                labels.set(name.toLowerCase(), id)
              }
              ids.push(id)
            }
            await tx.ticketLabel.createMany({ data: [...new Set(ids)].map((labelId) => ({ ticketId: ticket.id, labelId })), skipDuplicates: true })
          }

          if (entry.criteria.length) {
            await addChecklistItems(tx, { ticketId: ticket.id, texts: entry.criteria.map((criterion) => criterion.text), actorId: actor.id })
            const done = entry.criteria.filter((criterion) => criterion.done).map((criterion) => criterion.text.replace(/\s+/g, ' ').trim())
            if (done.length) await tx.ticketChecklistItem.updateMany({ where: { ticketId: ticket.id, text: { in: done } }, data: { isDone: true, doneAt: createdAt, doneById: actor.id } })
          }

          for (const comment of entry.comments.filter((row) => row.body.trim())) {
            const at = date(comment.at)
            await tx.comment.create({
              data: {
                ticketId: ticket.id,
                authorId: actor.id,
                body: `${comment.author || at ? `_${[comment.author ? `Originally by ${comment.author}` : 'Imported', at ? `on ${at.toISOString().slice(0, 10)}` : ''].filter(Boolean).join(' ')}:_\n\n` : ''}${comment.body}`,
                createdAt: at ?? createdAt,
              },
            })
          }
          created++
        }

        await recordActivity(tx, {
          action: 'CREATED',
          entityType: 'PROJECT',
          entityId: data.projectId,
          projectId: data.projectId,
          actorId: actor.id,
          field: 'import',
          newValue: String(created),
          summary: `imported ${created} tickets from ${data.source === 'csv' ? 'a spreadsheet' : data.source === 'jira' ? 'Jira' : 'Trello'}`,
        })
        return { created, skipped: data.items.length - created }
      },
      { timeout: 120_000 },
    )

    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok(result)
  })
}

/**
 * The last step: children to their parents, by original key, once every batch
 * has landed. A link the two-level rule refuses is reported, not forced.
 */
export async function linkImportedParentsAction(raw: {
  projectId: string
  source: 'jira' | 'trello' | 'csv'
  pairs: Array<{ ref: string; parentRef: string }>
}): Promise<ActionResult<{ linked: number; refused: string[] }>> {
  return runAction(async () => {
    const data = z
      .object({ projectId: z.string().min(1), source: z.enum(['jira', 'trello', 'csv']), pairs: z.array(z.object({ ref: z.string(), parentRef: z.string() })).max(5000) })
      .parse(raw)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    const refs = [...new Set(data.pairs.flatMap((pair) => [pair.ref, pair.parentRef]))].map((ref) => `${data.source}:${ref}`)
    const tickets = await prisma.ticket.findMany({
      where: { projectId: data.projectId, externalRef: { in: refs } },
      select: { id: true, key: true, externalRef: true, parentId: true },
    })
    const byRef = new Map(tickets.map((ticket) => [ticket.externalRef!, ticket]))
    let linked = 0
    const refused: string[] = []
    const parents = new Set<string>()
    for (const pair of data.pairs) {
      const child = byRef.get(`${data.source}:${pair.ref}`)
      const parent = byRef.get(`${data.source}:${pair.parentRef}`)
      if (!child || !parent || child.parentId === parent.id) continue
      try {
        await prisma.$transaction(async (tx) => {
          await validateParentAssignment(tx, child.id, parent.id, data.projectId)
          await tx.ticket.update({ where: { id: child.id }, data: { parentId: parent.id } })
        })
        parents.add(parent.id)
        linked++
      } catch {
        refused.push(child.key)
      }
    }
    for (const parentId of parents) await prisma.$transaction((tx) => applyParentRollup(tx, parentId, actor.id))
    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok({ linked, refused })
  })
}
