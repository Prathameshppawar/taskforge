import { prisma } from '@/infrastructure/db/prisma'
import { HANDBOOK_KEY } from '@/core/domain/project-documents'

/**
 * Reads of a project's documents. Callers check project visibility first; these
 * only shape the rows.
 */

export interface DocumentSummary {
  key: string
  title: string
  latestVersion: number
  versionCount: number
  source: string
  author: string | null
  updatedAt: Date
}

/** Every document the project has, handbook first, each at its latest version. */
export async function listProjectDocuments(projectId: string): Promise<DocumentSummary[]> {
  const groups = await prisma.projectDocument.groupBy({
    by: ['kind'],
    where: { projectId },
    _max: { version: true },
    _count: { _all: true },
  })
  if (groups.length === 0) return []

  // Bodies are left out: a list of twenty documents should not read megabytes.
  const latest = await prisma.projectDocument.findMany({
    where: { projectId, OR: groups.map((group) => ({ kind: group.kind, version: group._max.version ?? 0 })) },
    select: { kind: true, version: true, title: true, source: true, createdAt: true, author: { select: { name: true } } },
  })
  const counts = new Map(groups.map((group) => [group.kind, group._count._all]))

  return latest
    .map((row) => ({
      key: row.kind,
      title: row.title,
      latestVersion: row.version,
      versionCount: counts.get(row.kind) ?? 1,
      source: row.source,
      author: row.author?.name ?? null,
      updatedAt: row.createdAt,
    }))
    .sort((a, b) => (a.key === HANDBOOK_KEY ? -1 : b.key === HANDBOOK_KEY ? 1 : a.title.localeCompare(b.title)))
}

export interface DocumentVersion {
  version: number
  title: string
  body: string
  source: string
  engine: string | null
  author: string | null
  createdAt: Date
}

/** A document's versions, newest first, with their text. */
export async function getDocumentVersions(projectId: string, key: string, take = 30): Promise<DocumentVersion[]> {
  const rows = await prisma.projectDocument.findMany({
    where: { projectId, kind: key },
    orderBy: { version: 'desc' },
    take,
    select: { version: true, title: true, body: true, source: true, engine: true, createdAt: true, author: { select: { name: true } } },
  })
  return rows.map(({ author, ...row }) => ({ ...row, author: author?.name ?? null }))
}

/** One version of a document — the latest when `version` is omitted. */
export async function getDocument(projectId: string, key: string, version?: number): Promise<DocumentVersion | null> {
  const row = await prisma.projectDocument.findFirst({
    where: { projectId, kind: key, ...(version ? { version } : {}) },
    orderBy: { version: 'desc' },
    select: { version: true, title: true, body: true, source: true, engine: true, createdAt: true, author: { select: { name: true } } },
  })
  if (!row) return null
  const { author, ...rest } = row
  return { ...rest, author: author?.name ?? null }
}
