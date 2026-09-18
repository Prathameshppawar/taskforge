#!/usr/bin/env node
/**
 * TaskForge MCP server.
 *
 * A thin stdio bridge: it exposes the Copilot's tools to any MCP client and
 * forwards each call to the deployed app, authenticated with a personal access
 * token.
 *
 * Deliberately thin. It holds no business logic and talks to no database — the
 * server it calls resolves the token into the same Actor a browser session
 * produces, so every permission check, transaction and audit entry is identical
 * to a human performing the action. An agent cannot do anything its user
 * could not do by hand, and nothing here could grant it more.
 *
 *   TASKFORGE_URL=https://your-app.vercel.app \
 *   TASKFORGE_TOKEN=tf_xxx \
 *   npx tsx mcp/server.ts
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

const BASE_URL = (process.env.TASKFORGE_URL ?? '').replace(/\/+$/, '')
const TOKEN = process.env.TASKFORGE_TOKEN ?? ''
const DEFAULT_PROJECT = process.env.TASKFORGE_PROJECT

if (!BASE_URL || !TOKEN) {
  // stderr, never stdout — stdout is the MCP protocol channel and any stray
  // byte on it corrupts the stream.
  console.error(
    'TaskForge MCP: set TASKFORGE_URL and TASKFORGE_TOKEN.\n' +
      'Create a token under Settings → Access tokens.',
  )
  process.exit(1)
}

interface Catalogue {
  actor: { username: string; name: string; role: string }
  projects: Array<{ code: string; name: string }>
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`TaskForge returned non-JSON (${response.status}): ${text.slice(0, 200)}`)
  }

  if (response.status === 401) {
    throw new Error('TaskForge rejected the token. It may be revoked or expired.')
  }

  return payload as T
}

async function main() {
  // Fetch the catalogue once so the tool list always matches the deployment —
  // adding a tool server-side needs no change here.
  const catalogue = await api<Catalogue>('/api/mcp')

  const server = new Server(
    { name: 'taskforge', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalogue.tools.map(
      (tool): Tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Tool['inputSchema'],
      }),
    ),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      const result = await api<{ ok: boolean; summary: string; data?: unknown }>('/api/mcp', {
        method: 'POST',
        body: JSON.stringify({
          tool: name,
          arguments: args ?? {},
          projectCode: DEFAULT_PROJECT,
        }),
      })

      return {
        content: [{ type: 'text' as const, text: result.summary }],
        // A refused or failed tool is reported as an error to the model so it
        // can react, rather than being narrated as success.
        isError: !result.ok,
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: error instanceof Error ? error.message : 'The call failed.',
          },
        ],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error(
    `TaskForge MCP ready — ${catalogue.tools.length} tools as ` +
      `${catalogue.actor.name} (${catalogue.actor.role}), ` +
      `${catalogue.projects.length} projects visible.`,
  )
}

main().catch((error) => {
  console.error('TaskForge MCP failed to start:', error.message)
  process.exit(1)
})
