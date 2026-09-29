import { createHash } from 'node:crypto'

import { prisma } from '@/infrastructure/db/prisma'
import { asInstallation } from '@/infrastructure/github/client'
import { getEmbedder } from '@/infrastructure/ai/embedder'
import { clip } from '@/core/domain/ticket-context'
import { chunkMarkdown, isDocPath } from '@/core/domain/memory'

/**
 * Project memory: what the project already knows, made searchable.
 *
 * Three sources, re-read on each run and embedded only where the text
 * changed: finished tickets with how they were resolved, the linked
 * repositories' documentation, and the handbook. Embedded in-process by the
 * same free model as ticket similarity, so indexing costs database space and
 * nothing else — which is why it is capped per project.
 */

export const MAX_CHUNKS_PER_PROJECT = 3000
const MAX_DOC_FILES = 25

interface Chunk {
  sourceType: 'TICKET' | 'REPO_DOC' | 'HANDBOOK'
  sourceId: string
  chunkIndex: number
  title: string
  url: string | null
  text: string
}

function md5(text: string) {
  return createHash('md5').update(text).digest('hex')
}

function vectorLiteral(vector: Float32Array): string {
  return `{${Array.from(vector, (value) => value.toFixed(6)).join(',')}}`
}

export async function indexJob(payload: Record<string, unknown>) {
  await indexProject(String(payload.projectId))
}

export async function indexProject(projectId: string): Promise<{ chunks: number; embedded: number; removed: number } | null> {
  const settings = await prisma.projectSettings.findUnique({ where: { projectId }, select: { memoryEnabled: true } })
  const embedder = getEmbedder()
  if (!settings?.memoryEnabled || !embedder) return null

  const chunks = [...(await ticketChunks(projectId)), ...(await repoChunks(projectId)), ...(await handbookChunks(projectId))].slice(0, MAX_CHUNKS_PER_PROJECT)

  const existing = await prisma.memoryChunk.findMany({
    where: { projectId },
    select: { id: true, sourceType: true, sourceId: true, chunkIndex: true, hash: true },
  })
  const key = (chunk: { sourceType: string; sourceId: string; chunkIndex: number }) => `${chunk.sourceType}|${chunk.sourceId}|${chunk.chunkIndex}`
  const byKey = new Map(existing.map((row) => [key(row), row]))
  const wanted = new Set(chunks.map(key))

  // Only new or changed text is embedded.
  const changed = chunks.filter((chunk) => byKey.get(key(chunk))?.hash !== md5(chunk.text))
  let embedded = 0
  for (let start = 0; start < changed.length; start += 32) {
    const batch = changed.slice(start, start + 32)
    const vectors = await embedder.embed(batch.map((chunk) => `${chunk.title}\n${chunk.text}`.slice(0, 2000)))
    for (const [index, chunk] of batch.entries()) {
      const row = await prisma.memoryChunk.upsert({
        where: { projectId_sourceType_sourceId_chunkIndex: { projectId, sourceType: chunk.sourceType, sourceId: chunk.sourceId, chunkIndex: chunk.chunkIndex } },
        create: { projectId, ...chunk, hash: md5(chunk.text) },
        update: { title: chunk.title, url: chunk.url, text: chunk.text, hash: md5(chunk.text) },
        select: { id: true },
      })
      await prisma.$executeRawUnsafe(`UPDATE "memory_chunks" SET "embedding" = $1::real[] WHERE "id" = $2`, vectorLiteral(vectors[index]), row.id)
      embedded++
    }
  }

  const stale = existing.filter((row) => !wanted.has(key(row))).map((row) => row.id)
  if (stale.length) await prisma.memoryChunk.deleteMany({ where: { id: { in: stale } } })
  return { chunks: chunks.length, embedded, removed: stale.length }
}

/** A finished ticket and how it ended: the work, and the last words on it. */
async function ticketChunks(projectId: string): Promise<Chunk[]> {
  const tickets = await prisma.ticket.findMany({
    where: { projectId, isArchived: false, status: { category: 'DONE' } },
    orderBy: { completedAt: 'desc' },
    take: 1500,
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      type: { select: { name: true } },
      completedAt: true,
      comments: {
        where: { deletedAt: null, author: { isAgent: false } },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { body: true, author: { select: { name: true } } },
      },
      gitRefs: { where: { kind: 'PULL_REQUEST', state: 'MERGED' }, select: { title: true, url: true }, take: 3 },
    },
  })
  return tickets.map((ticket) => ({
    sourceType: 'TICKET' as const,
    sourceId: ticket.id,
    chunkIndex: 0,
    title: `${ticket.key}: ${ticket.title}`,
    url: `/tickets/${ticket.key}`,
    text: [
      `${ticket.type.name}, finished ${ticket.completedAt?.toISOString().slice(0, 10) ?? ''}.`,
      ticket.description ? clip(ticket.description, 900) : '',
      ...ticket.comments.reverse().map((comment) => `${comment.author.name}: ${clip(comment.body, 300)}`),
      ...ticket.gitRefs.map((ref) => `Merged: ${ref.title || ref.url}`),
    ]
      .filter(Boolean)
      .join('\n'),
  }))
}

/** The documentation of every repository linked to the project, by section. */
async function repoChunks(projectId: string): Promise<Chunk[]> {
  const links = await prisma.projectRepo.findMany({
    where: { projectId, repo: { isAccessible: true } },
    select: { repo: { select: { fullName: true, defaultBranch: true, installation: { select: { installationId: true } } } } },
  })
  const out: Chunk[] = []
  for (const { repo } of links) {
    try {
      const tree = await asInstallation<{ tree: Array<{ path: string; type: string; size?: number }> }>(
        repo.installation.installationId,
        `/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`,
      )
      const docs = tree.tree.filter((entry) => entry.type === 'blob' && isDocPath(entry.path) && (entry.size ?? 0) < 200_000).slice(0, MAX_DOC_FILES)
      for (const doc of docs) {
        const file = await asInstallation<{ content?: string }>(
          repo.installation.installationId,
          `/repos/${repo.fullName}/contents/${doc.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(repo.defaultBranch)}`,
        )
        if (!file.content) continue
        const text = Buffer.from(file.content, 'base64').toString('utf8')
        chunkMarkdown(text).forEach((piece, index) =>
          out.push({
            sourceType: 'REPO_DOC',
            sourceId: `${repo.fullName}:${doc.path}`,
            chunkIndex: index,
            title: `${repo.fullName} · ${doc.path}${piece.heading ? ` · ${piece.heading}` : ''}`,
            url: `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${doc.path}`,
            text: piece.text,
          }),
        )
      }
    } catch (error) {
      console.error(`[memory] could not read ${repo.fullName}:`, error)
    }
  }
  return out
}

async function handbookChunks(projectId: string): Promise<Chunk[]> {
  const latest = await prisma.projectDocument.findFirst({ where: { projectId, kind: 'HANDBOOK' }, orderBy: { version: 'desc' }, select: { id: true, body: true } })
  if (!latest) return []
  return chunkMarkdown(latest.body).map((piece, index) => ({
    sourceType: 'HANDBOOK' as const,
    sourceId: 'handbook',
    chunkIndex: index,
    title: `Handbook${piece.heading ? ` · ${piece.heading}` : ''}`,
    url: null,
    text: piece.text,
  }))
}

export interface MemoryHit {
  title: string
  url: string | null
  text: string
  sourceType: string
  score: number
}

/** The project's memory, searched by meaning. */
export async function searchMemory(projectId: string, query: string, limit = 5, minScore = 0.3): Promise<MemoryHit[]> {
  const embedder = getEmbedder()
  if (!embedder || !query.trim()) return []
  const [vector] = await embedder.embed([query.trim().slice(0, 1000)])
  const rows = await prisma.$queryRawUnsafe<MemoryHit[]>(
    `SELECT "title", "url", "text", "sourceType",
            (SELECT sum(a * b) FROM unnest("embedding", $1::real[]) AS u(a, b))::float8 AS score
       FROM "memory_chunks"
      WHERE "projectId" = $2 AND "embedding" IS NOT NULL
      ORDER BY score DESC
      LIMIT $3`,
    vectorLiteral(vector),
    projectId,
    limit,
  )
  return rows.filter((row) => row.score >= minScore)
}

export async function memoryStats(projectId: string) {
  const rows = await prisma.memoryChunk.groupBy({ by: ['sourceType'], where: { projectId }, _count: { _all: true } })
  return Object.fromEntries(rows.map((row) => [row.sourceType, row._count._all])) as Record<string, number>
}
