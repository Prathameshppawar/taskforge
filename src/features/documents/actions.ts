'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import { requireProjectPermission } from '@/features/auth/guards'
import { enqueue } from '@/features/jobs/queue'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { documentKey } from '@/core/domain/project-documents'
import { runAction } from '@/lib/safe-action'
import { saveDocumentSchema, type SaveDocumentInput } from './schemas'
import { latestDocumentVersion, writeDocumentVersion } from './service'

/**
 * A person's new document, or their revision of one — always a new version,
 * never an overwrite. The same permission as editing the handbook: documents
 * are project configuration a manager owns.
 */
export async function saveProjectDocumentAction(
  input: SaveDocumentInput,
): Promise<ActionResult<{ key: string; version: number }>> {
  return runAction(async () => {
    const data = saveDocumentSchema.parse(input)
    const { actor } = await requireProjectPermission(data.projectId, 'project:manage-config')

    const key = data.key ?? documentKey(data.title ?? '')
    if (!key) return fail('Give the document a name with letters or numbers in it.', { fieldErrors: { title: ['Use letters or numbers.'] } })

    // Starting a document whose name is already taken would quietly add a
    // version to someone else's document; say so instead.
    if (!data.key && (await latestDocumentVersion(prisma, data.projectId, key)) > 0) {
      return fail(`There is already a document called "${data.title}". Open it to add a version.`, { code: 'CONFLICT' })
    }

    const { version } = await prisma.$transaction((tx) =>
      writeDocumentVersion(tx, {
        projectId: data.projectId,
        key,
        title: data.title,
        body: data.body,
        source: 'EDIT',
        authorId: actor.id,
        actorId: actor.id,
      }),
    )

    // Documents are part of what the project remembers.
    await enqueue('memory.index', { projectId: data.projectId }, { dedupeKey: `memory:${data.projectId}` })
    revalidatePath(`/projects/${data.projectId}`, 'layout')
    return ok({ key, version })
  })
}
