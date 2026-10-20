import { NextResponse, type NextRequest } from 'next/server'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser, projectVisibilityFilter } from '@/features/auth/guards'
import { executeTool } from '@/features/ai/executor'
import { getToolDefinitions, isToolName } from '@/features/ai/tools'
import { DomainError } from '@/core/domain/errors'

/**
 * Remote MCP server (Streamable HTTP).
 *
 * The same tools as `/api/mcp`, spoken in the MCP protocol itself, so a client
 * connects to this URL directly instead of running the `mcp/server.ts` bridge:
 *
 *   claude mcp add --transport http taskforge 'https://<app>/api/mcp/http?project=DEMO' \
 *     --header "Authorization: Bearer tf_..."
 *
 * The token resolves into the same Actor as everywhere else, so permissions,
 * project visibility and the activity log are unchanged. `?project=` plays the
 * part of the bridge's TASKFORGE_PROJECT.
 *
 * Stateless: every POST gets a fresh server and transport and is answered with
 * plain JSON rather than an SSE stream, which suits a serverless function. GET
 * (a standing notification stream) and DELETE (ending a session) are not
 * exported, so Next answers 405 — what the spec asks of a server that offers
 * neither.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor) {
    return NextResponse.json(
      { error: 'Unauthorized. Send Authorization: Bearer <token>.' },
      { status: 401 },
    )
  }

  // The default project, scoped to what this actor can see. An unknown code is
  // ignored, as on /api/mcp, and a tool that needs a project will ask for one.
  let currentProjectId: string | undefined
  const projectCode = request.nextUrl.searchParams.get('project')
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

  const server = new Server(
    { name: 'taskforge', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions().map(
      (tool): Tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters as Tool['inputSchema'],
      }),
    ),
  }))

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    // A refused or failed tool is reported as an error to the model so it can
    // react, rather than being narrated as success.
    const reply = (text: string, isError: boolean) => ({
      content: [{ type: 'text' as const, text }],
      isError,
    })

    if (!isToolName(params.name)) return reply(`Unknown tool "${params.name}".`, true)

    try {
      const result = await executeTool(params.name, params.arguments ?? {}, {
        actor,
        currentProjectId,
      })
      return reply(result.summary, !result.ok)
    } catch (error) {
      // A guard refusing the call is a legitimate answer, not a server fault.
      if (error instanceof DomainError) return reply(error.message, true)
      console.error('[api/mcp/http] tool failed:', error)
      return reply('The tool failed unexpectedly.', true)
    }
  })

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
