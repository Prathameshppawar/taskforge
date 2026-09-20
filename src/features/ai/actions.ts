'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/infrastructure/db/prisma'
import {
  requireActor,
  requirePermission,
  ticketVisibilityFilter,
  can,
} from '@/features/auth/guards'
import { isAiEnabled } from '@/lib/env'
import { AiProviderError } from '@/infrastructure/ai'
import { ok, fail, type ActionResult } from '@/core/domain/result'
import { runAction } from '@/lib/safe-action'
import { runCopilotTurn, type CopilotTurn } from './service'
import { extractBreakdown, type ExtractedBreakdown } from './extract'
import { executeTool } from './executor'

export interface CopilotRequest {
  message: string
  /** Set by the Approve button — runs the pending writes for real. */
  approve?: boolean
  projectId?: string
  /** What the user is looking at, so "this ticket" and "these" resolve. */
  screen?: { view: string; ticketKey?: string; filters?: string }
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function copilotAction(
  input: CopilotRequest,
): Promise<ActionResult<CopilotTurn>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:use')

    if (!isAiEnabled()) {
      return fail(
        'The AI Copilot is not configured. Set AI_PROVIDER to "groq" or "ollama" and add the matching credentials.',
        { code: 'AI_DISABLED' },
      )
    }

    const message = input.message.trim()
    if (!message) return fail('Type something for the Copilot to work on.')
    if (message.length > 4000) {
      return fail('That message is too long. Try breaking it into smaller requests.')
    }

    // Resolve the open project for context, but only if the actor can see it.
    let projectName: string | undefined
    let projectCode: string | undefined

    if (input.projectId) {
      const project = await prisma.project.findFirst({
        where: {
          id: input.projectId,
          ...(can(actor, 'project:view-all')
            ? {}
            : {
                OR: [
                  { ownerId: actor.id },
                  { members: { some: { userId: actor.id } } },
                ],
              }),
        },
        select: { name: true, code: true },
      })
      projectName = project?.name
      projectCode = project?.code
    }

    try {
      // Resolve the open ticket's title so the model can refer to it by name
      // rather than only by key — and only if the actor may actually see it.
      let openTicket: { key: string; title: string; status: string } | undefined
      if (input.screen?.ticketKey) {
        const found = await prisma.ticket.findFirst({
          where: {
            key: input.screen.ticketKey.toUpperCase(),
            ...ticketVisibilityFilter(actor),
          },
          select: { key: true, title: true, status: { select: { name: true } } },
        })
        if (found) {
          openTicket = { key: found.key, title: found.title, status: found.status.name }
        }
      }

      const turn = await runCopilotTurn(
        {
          actor,
          projectId: projectName ? input.projectId : undefined,
          projectName,
          projectCode,
          screen: input.screen
            ? { view: input.screen.view, filters: input.screen.filters, openTicket }
            : undefined,
          autoApprove: input.approve === true,
        },
        input.history,
        message,
      )

      // Any tool that changed data means the views behind the panel are stale.
      const mutated = turn.toolRuns.some(
        (run) =>
          run.result.ok &&
          (run.name === 'create_ticket' ||
            run.name === 'bulk_create_tickets' ||
            run.name === 'update_ticket'),
      )

      if (mutated) {
        revalidatePath('/dashboard')
        revalidatePath('/my-tickets')
        if (input.projectId) revalidatePath(`/projects/${input.projectId}`, 'layout')
      }

      return ok(turn)
    } catch (error) {
      if (error instanceof AiProviderError) {
        return fail(error.message, { code: 'AI_PROVIDER' })
      }
      throw error
    }
  })
}

/** Reports whether the panel should offer itself at all. */
export async function getAiStatusAction(): Promise<
  ActionResult<{ enabled: boolean; provider: string }>
> {
  return runAction(async () => {
    await requireActor()
    return ok({
      enabled: isAiEnabled(),
      provider: process.env.AI_PROVIDER ?? 'none',
    })
  })
}

export interface CaptureRequest {
  text: string
  projectId?: string
  projectCode?: string
}

export interface CaptureResult {
  breakdown: ExtractedBreakdown
  /** Passed straight back on confirm, so the model is not asked twice. */
  rawArguments: Record<string, unknown>
}

/**
 * Notes in, proposed breakdown out. Writes nothing.
 */
export async function captureAction(
  input: CaptureRequest,
): Promise<ActionResult<CaptureResult>> {
  return runAction(async () => {
    await requirePermission('ai:use')

    if (!isAiEnabled()) {
      return fail('The AI Copilot is not configured.', { code: 'AI_DISABLED' })
    }

    try {
      const result = await extractBreakdown(input.text, input.projectCode)
      if (!result.ok) return fail(result.reason)

      return ok({ breakdown: result.breakdown, rawArguments: result.rawArguments })
    } catch (error) {
      if (error instanceof AiProviderError) return fail(error.message, { code: error.kind })
      throw error
    }
  })
}

/**
 * Creates what the user approved.
 *
 * Routed through the same executor as every Copilot write, so it inherits the
 * project permission check, the resolver and the audit entries rather than
 * reimplementing them next to the capture dialog.
 */
export async function confirmCaptureAction(
  input: { rawArguments: Record<string, unknown>; projectId?: string },
): Promise<ActionResult<{ summary: string }>> {
  return runAction(async () => {
    const actor = await requirePermission('ai:use')

    const result = await executeTool('bulk_create_tickets', input.rawArguments, {
      actor,
      currentProjectId: input.projectId,
      // Already approved by the person looking at the breakdown.
      propose: false,
    })

    if (!result.ok) return fail(result.summary)

    if (input.projectId) revalidatePath(`/projects/${input.projectId}`)
    return ok({ summary: result.summary })
  })
}
