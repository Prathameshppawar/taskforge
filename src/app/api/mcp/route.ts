import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser, projectVisibilityFilter } from '@/features/auth/guards'
import { executeTool } from '@/features/ai/executor'
import { getToolDefinitions, isToolName } from '@/features/ai/tools'
import { DomainError } from '@/core/domain/errors'

/**
 * MCP bridge.
 *
 * Exposes the Copilot's tools to any MCP client. Authentication is a personal
 * access token, and `getCurrentUser` resolves it into exactly the same Actor a
 * browser session produces — so an agent inherits its user's permissions and
 * every call it makes is audited identically. There is no service account and
 * no elevated path.
 *
 * Runs on Node (not Edge) because the executor reaches Prisma.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const callSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.unknown()).default({}),
  /** Optional project context, mirroring the "currently open project" in the UI. */
  projectCode: z.string().optional(),
})

/** Tool catalogue — lets a client discover the surface before calling it. */
export async function GET() {
  const actor = await getCurrentUser()
  if (!actor) {
    return NextResponse.json(
      { error: 'Unauthorized. Send Authorization: Bearer <token>.' },
      { status: 401 },
    )
  }

  const projects = await prisma.project.findMany({
    where: { isArchived: false, ...projectVisibilityFilter(actor) },
    select: { code: true, name: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({
    actor: { username: actor.username, name: actor.name, role: actor.roleKey },
    projects,
    tools: getToolDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  })
}

export async function POST(request: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor) {
    return NextResponse.json(
      { error: 'Unauthorized. Send Authorization: Bearer <token>.' },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const parsed = callSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected { tool, arguments }.', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { tool, arguments: args, projectCode } = parsed.data

  if (!isToolName(tool)) {
    return NextResponse.json(
      { error: `Unknown tool "${tool}".`, available: getToolDefinitions().map((t) => t.name) },
      { status: 404 },
    )
  }

  // Resolve the optional project context, scoped to what this actor can see.
  let currentProjectId: string | undefined
  if (projectCode) {
    const project = await prisma.project.findFirst({
      where: {
        code: projectCode.toUpperCase(),
        ...projectVisibilityFilter(actor),
      },
      select: { id: true },
    })
    currentProjectId = project?.id
  }

  try {
    const result = await executeTool(tool, args, { actor, currentProjectId })
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (error) {
    // A guard refusing the call is a legitimate answer, not a server fault.
    if (error instanceof DomainError) {
      return NextResponse.json(
        { ok: false, summary: error.message, code: error.code },
        { status: error.status },
      )
    }
    console.error('[api/mcp] tool failed:', error)
    return NextResponse.json(
      { ok: false, summary: 'The tool failed unexpectedly.' },
      { status: 500 },
    )
  }
}
