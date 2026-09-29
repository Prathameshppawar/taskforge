'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { recordActivity } from '@/features/activity/service'
import { requireProjectPermission, requireProjectView } from '@/features/auth/guards'
import { enqueue } from '@/features/jobs/queue'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { generateHandbook } from './handbook'
import { indexProject } from './index-service'

export async function generateHandbookAction(projectId: string): Promise<ActionResult<{ version: number; source: string }>> {
  return runAction(async () => {
    const { actor } = await requireProjectPermission(z.string().min(1).parse(projectId), 'project:manage-config')
    const result = await generateHandbook(projectId, actor.id)
    revalidatePath(`/projects/${projectId}/handbook`)
    return ok(result)
  })
}

/** A person's revision is a new version, never an overwrite. */
export async function saveHandbookAction(input: { projectId: string; body: string }): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const data = z.object({ projectId: z.string().min(1), body: z.string().trim().min(20).max(100_000) }).parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    const last = await prisma.projectDocument.findFirst({ where: { projectId: data.projectId, kind: 'HANDBOOK' }, orderBy: { version: 'desc' }, select: { version: true, title: true } })
    const project = await prisma.project.findUniqueOrThrow({ where: { id: data.projectId }, select: { name: true } })
    const version = (last?.version ?? 0) + 1
    await prisma.projectDocument.create({
      data: { projectId: data.projectId, kind: 'HANDBOOK', version, title: last?.title ?? `${project.name} handbook`, body: data.body, source: 'EDIT', authorId: actor.id },
    })
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'PROJECT',
      entityId: data.projectId,
      projectId: data.projectId,
      actorId: actor.id,
      field: 'handbook',
      newValue: String(version),
      summary: `edited the project handbook (version ${version})`,
    })
    await enqueue('memory.index', { projectId: data.projectId }, { dedupeKey: `memory:${data.projectId}` })
    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok({ version })
  })
}

export async function markHandbookReadAction(input: { projectId: string; version: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ projectId: z.string().min(1), version: z.number().int().min(1) }).parse(input)
    const { actor } = await requireProjectView(data.projectId)
    await prisma.projectDocumentRead.upsert({
      where: { userId_projectId_kind: { userId: actor.id, projectId: data.projectId, kind: 'HANDBOOK' } },
      create: { userId: actor.id, projectId: data.projectId, kind: 'HANDBOOK', version: data.version },
      update: { version: data.version, readAt: new Date() },
    })
    return ok()
  })
}

const TOGGLES = ['memoryEnabled', 'handbookAutoRefresh', 'triageAgent', 'dailyDigest', 'liveUpdates'] as const
export type ProjectToggle = (typeof TOGGLES)[number]

/** One of the project's automation switches. Each is project configuration. */
export async function setProjectToggleAction(input: { projectId: string; key: ProjectToggle; value: boolean }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const data = z.object({ projectId: z.string().min(1), key: z.enum(TOGGLES), value: z.boolean() }).parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')
    await prisma.projectSettings.update({ where: { projectId: data.projectId }, data: { [data.key]: data.value } })
    // Turning memory off also forgets it: the index is only ever a copy.
    if (data.key === 'memoryEnabled' && !data.value) await prisma.memoryChunk.deleteMany({ where: { projectId: data.projectId } })
    if (data.key === 'memoryEnabled' && data.value) await enqueue('memory.index', { projectId: data.projectId }, { dedupeKey: `memory:${data.projectId}` })
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'PROJECT',
      entityId: data.projectId,
      projectId: data.projectId,
      actorId: actor.id,
      field: data.key,
      newValue: String(data.value),
      summary: `turned ${data.value ? 'on' : 'off'} ${TOGGLE_NAMES[data.key]}`,
    })
    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok()
  })
}

const TOGGLE_NAMES: Record<ProjectToggle, string> = {
  memoryEnabled: 'project memory',
  handbookAutoRefresh: 'the weekly handbook refresh',
  triageAgent: 'TaskForge Triage',
  dailyDigest: 'the morning digest',
  liveUpdates: 'live updates',
}

export async function reindexMemoryAction(projectId: string): Promise<ActionResult<{ chunks: number; embedded: number; removed: number }>> {
  return runAction(async () => {
    await requireProjectPermission(z.string().min(1).parse(projectId), 'project:manage-config')
    const result = await indexProject(projectId)
    if (!result) return fail('Memory is off for this project, or the embedding model is unavailable here.')
    revalidatePath(`/projects/${projectId}/settings`)
    return ok(result)
  })
}
