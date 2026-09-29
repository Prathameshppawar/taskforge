import { NextResponse } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser, projectVisibilityFilter, type Actor } from '@/features/auth/guards'
import { executeTool } from '@/features/ai/executor'
import type { ToolName } from '@/features/ai/tools'
import { DomainError } from '@/core/domain/errors'

/**
 * The public REST API, v1.
 *
 * A thin HTTP shape over the Copilot's tools — the same trust boundary the MCP
 * server uses. A personal access token resolves to the same Actor a browser
 * session does, arguments are validated by the same schemas, and every write
 * goes through the same Server Action as a click, so the API has no path of
 * its own to get wrong.
 */

export async function withActor(run: (actor: Actor) => Promise<Response>): Promise<Response> {
  const actor = await getCurrentUser()
  if (!actor) return NextResponse.json({ error: 'Unauthorized. Send Authorization: Bearer <personal access token>.' }, { status: 401 })
  try {
    return await run(actor)
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status })
    console.error('[api/v1] failed:', error)
    return NextResponse.json({ ok: false, error: 'The request failed unexpectedly.' }, { status: 500 })
  }
}

export async function tool(actor: Actor, name: ToolName, args: Record<string, unknown>, projectCode?: string | null, created = false): Promise<Response> {
  let currentProjectId: string | undefined
  if (projectCode) {
    const project = await prisma.project.findFirst({ where: { code: projectCode.toUpperCase(), ...projectVisibilityFilter(actor) }, select: { id: true } })
    if (!project) return NextResponse.json({ ok: false, error: `No project ${projectCode.toUpperCase()} that you can see.` }, { status: 404 })
    currentProjectId = project.id
  }
  const result = await executeTool(name, args, { actor, currentProjectId })
  return NextResponse.json(
    { ok: result.ok, message: result.summary, ...(('data' in result && result.data) ? { data: result.data } : {}) },
    { status: result.ok ? (created ? 201 : 200) : /not found|does not exist|no ticket/i.test(result.summary) ? 404 : 422 },
  )
}

export async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const badBody = () => NextResponse.json({ ok: false, error: 'The body must be a JSON object.' }, { status: 400 })
