import type { Prisma } from '@prisma/client'

import { recordActivity } from '@/features/activity/service'
import { HANDBOOK_KEY, titleFromKey } from '@/core/domain/project-documents'

type Tx = Prisma.TransactionClient

/**
 * Writing a project document.
 *
 * One function for every way a version comes about by hand — a manager's edit
 * of the handbook or a named document, and an approved proposal — so they are
 * numbered, titled and audited the same way. (The handbook generator writes its
 * own AI and FACTS versions.) A version is never overwritten: each save is the
 * next number, and the unique (project, kind, version) index turns two saves
 * racing for the same number into a conflict rather than a lost edit.
 */
export interface WriteDocumentInput {
  projectId: string
  /** HANDBOOK or a named document's slug. */
  key: string
  /** Keeps the current title when omitted. */
  title?: string
  body: string
  source: 'EDIT' | 'PROPOSAL'
  /** Who wrote the text: the editor, or a proposal's proposer. */
  authorId: string | null
  /** Who made it happen, for the activity log: the editor, or the approver. */
  actorId: string
  /** Replaces the default activity summary — an approval names the proposer. */
  summary?: (version: number, title: string) => string
}

export async function writeDocumentVersion(
  tx: Tx,
  input: WriteDocumentInput,
): Promise<{ version: number; title: string }> {
  const last = await tx.projectDocument.findFirst({
    where: { projectId: input.projectId, kind: input.key },
    orderBy: { version: 'desc' },
    select: { version: true, title: true },
  })
  const version = (last?.version ?? 0) + 1
  const title = input.title?.trim() || last?.title || (await defaultTitle(tx, input.projectId, input.key))

  await tx.projectDocument.create({
    data: {
      projectId: input.projectId,
      kind: input.key,
      version,
      title,
      body: input.body,
      source: input.source,
      authorId: input.authorId,
    },
  })

  const name = input.key === HANDBOOK_KEY ? 'the project handbook' : `the ${title} document`
  await recordActivity(tx, {
    action: version === 1 ? 'CREATED' : 'UPDATED',
    entityType: 'PROJECT',
    entityId: input.projectId,
    projectId: input.projectId,
    actorId: input.actorId,
    // The handbook keeps the field it has always been logged under.
    field: input.key === HANDBOOK_KEY ? 'handbook' : `document:${input.key}`,
    newValue: String(version),
    summary:
      input.summary?.(version, title) ??
      (version === 1 ? `wrote ${name}` : `edited ${name} (version ${version})`),
  })

  return { version, title }
}

async function defaultTitle(tx: Tx, projectId: string, key: string): Promise<string> {
  if (key !== HANDBOOK_KEY) return titleFromKey(key)
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } })
  return `${project.name} handbook`
}

/** The latest version number of a document, 0 when it does not exist yet. */
export async function latestDocumentVersion(tx: Tx, projectId: string, key: string): Promise<number> {
  const last = await tx.projectDocument.findFirst({
    where: { projectId, kind: key },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return last?.version ?? 0
}
