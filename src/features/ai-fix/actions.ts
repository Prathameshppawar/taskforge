'use server'

import { randomUUID } from 'node:crypto'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/infrastructure/db/prisma'
import { agentEngine, listCodingEngines } from '@/features/ai-admin/engines'
import { assertWithinBudget } from '@/features/ai-admin/usage'
import { can, requireProjectPermission } from '@/features/auth/guards'
import { ok, type ActionResult } from '@/core/domain/result'
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/core/domain/errors'
import { runAction } from '@/lib/safe-action'
import { isEngineId } from '@/core/domain/engine-catalog'
import { executeFixRun } from './service'

const startSchema = z.object({
  ticketId: z.string().min(1),
  repoId: z.string().min(1),
  engine: z.string().refine(isEngineId, 'Unknown engine.'),
  instructions: z.string().trim().max(2000).optional(),
  /** PLAN posts a plan for approval; FIX writes the change. */
  mode: z.enum(['FIX', 'PLAN']).default('FIX'),
  /** Build the plan from this PLAN run. */
  planRunId: z.string().optional(),
  /** HEAL_CI: the pull request to fix. Set by healPullRequestAction. */
  targetPrNumber: z.number().int().positive().optional(),
})

/**
 * Starts a "Fix with AI" run and returns immediately.
 *
 * The work continues in `after()`, past the response, because a run takes
 * anywhere from twenty seconds to several minutes and nobody should hold a
 * request open for that. The ticket page polls the run row for progress.
 *
 * Three gates: `ai:code` (it costs money and writes to a repository), the
 * ordinary ability to edit this ticket, and the repository being linked to the
 * ticket's project — so nobody can point a model at a repository the project
 * was never given.
 */
export async function startAiFixAction(
  input: z.input<typeof startSchema>,
): Promise<ActionResult<{ runId: string }>> {
  return runAction(async () => {
    const data = startSchema.parse(input)

    const ticket = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, key: true, projectId: true },
    })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)

    const { actor } = await requireProjectPermission(ticket.projectId, 'ticket:update')
    if (!can(actor, 'ai:code')) throw new ForbiddenError('Your role cannot start AI fixes (ai:code).')

    // "ALL": one run per linked repository, in a batch, for a ticket that spans
    // an app, its API and its CMS. Otherwise the one repository chosen.
    const links = await prisma.projectRepo.findMany({
      where: { projectId: ticket.projectId, ...(data.repoId === 'ALL' ? {} : { repoId: data.repoId }), repo: { isAccessible: true } },
      orderBy: { createdAt: 'asc' },
      select: { repoId: true, role: true, repo: { select: { fullName: true } } },
    })
    if (links.length === 0) {
      throw new BusinessRuleError(data.repoId === 'ALL' ? 'No accessible repository is linked to this project.' : 'That repository is not linked to this project, or the app lost access to it.')
    }
    if (data.repoId === 'ALL' && (data.mode === 'PLAN' || data.targetPrNumber)) {
      throw new BusinessRuleError('Planning and healing work on one repository at a time.')
    }

    const engine = (await listCodingEngines()).find((candidate) => candidate.id === data.engine)
    if (!engine) throw new BusinessRuleError(`The ${data.engine} engine is not configured on this server.`)

    await assertWithinBudget({ projectId: ticket.projectId, provider: engine.id })

    const active = await prisma.aiFixRun.count({
      where: { ticketId: ticket.id, status: { in: ['QUEUED', 'RUNNING'] } },
    })
    if (active > 0) throw new BusinessRuleError('A fix is already running for this ticket.')

    if (data.planRunId) {
      const plan = await prisma.aiFixRun.findFirst({
        where: { id: data.planRunId, ticketId: ticket.id, mode: 'PLAN', status: 'SUCCEEDED' },
        select: { id: true },
      })
      if (!plan) throw new BusinessRuleError('That plan is not available to build.')
    }

    // The agent's own model when it is the agent's engine that was chosen.
    const agent = await agentEngine(data.mode === 'PLAN' ? 'planner' : 'coder')
    const model = agent && agent.id === engine.id ? agent.model : engine.model

    const batchId = links.length > 1 ? randomUUID() : null
    const scope = (current: (typeof links)[number]) =>
      links.length > 1
        ? `This ticket spans ${links.length} repositories: ${links
            .map((entry) => `${entry.repo.fullName}${entry.role ? ` (${entry.role})` : ''}`)
            .join(', ')}. You are working in ${current.repo.fullName}${current.role ? `, the ${current.role}` : ''}. Change only what belongs in this repository; if nothing does, change nothing and say so. The others are being changed separately.`
        : null
    const runs: Array<{ id: string }> = []
    for (const link of links) {
      runs.push(
        await prisma.aiFixRun.create({
          data: {
            ticketId: ticket.id,
            repoId: link.repoId,
            requestedById: actor.id,
            provider: engine.id,
            model,
            instructions: [scope(link), data.instructions].filter(Boolean).join('\n\n') || null,
            mode: data.targetPrNumber ? 'HEAL_CI' : data.mode,
            planRunId: data.planRunId ?? null,
            targetPrNumber: data.targetPrNumber ?? null,
            batchId,
          },
          select: { id: true },
        }),
      )
    }
    const run = runs[0]

    // One after another, not in parallel: a rate-limited engine is kinder to a
    // queue than to a burst, and each run's links can include the ones before.
    after(async () => {
      for (const entry of runs) await executeFixRun(entry.id)
    })

    revalidatePath(`/tickets/${ticket.key}`)
    return ok({ runId: run.id })
  })
}

/**
 * "Fix failing checks" on one of the ticket's open pull requests — any pull
 * request, not only one an AI opened, because a person's red build is just as
 * worth a first attempt.
 */
export async function healPullRequestAction(input: {
  ticketId: string
  refId: string
  engine: string
}): Promise<ActionResult<{ runId: string }>> {
  const ref = await prisma.ticketGitRef.findFirst({
    where: { id: input.refId, ticketId: input.ticketId, kind: 'PULL_REQUEST', state: { in: ['OPEN', 'DRAFT'] } },
    select: { repoId: true, externalId: true },
  })
  if (!ref) return { success: false, error: 'That pull request is not open on this ticket.' }
  return startAiFixAction({
    ticketId: input.ticketId,
    repoId: ref.repoId,
    engine: input.engine,
    mode: 'FIX',
    targetPrNumber: Number(ref.externalId),
  })
}

const scaffoldSchema = z.object({
  ticketId: z.string().min(1),
  owner: z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'Choose a GitHub account.'),
  name: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/, 'Letters, numbers, dots, dashes and underscores only.'),
  description: z.string().trim().max(300).optional(),
  isPrivate: z.boolean().default(true),
  engine: z.string().refine(isEngineId, 'Unknown engine.'),
})

/**
 * "Start a new repository" from a ticket: create it as the person asking,
 * link it to the project, and have the Coder build its first version from the
 * ticket — description, conversation, attachments and resources — as a pull
 * request. Creating repositories and linking them is project configuration, so
 * it needs that right on top of the usual AI gates.
 */
export async function startScaffoldAction(input: z.input<typeof scaffoldSchema>): Promise<ActionResult<{ repo: string; runId: string }>> {
  return runAction(async () => {
    const data = scaffoldSchema.parse(input)
    const ticket = await prisma.ticket.findUnique({ where: { id: data.ticketId }, select: { id: true, key: true, projectId: true } })
    if (!ticket) throw new NotFoundError('Ticket', data.ticketId)
    const { actor } = await requireProjectPermission(ticket.projectId, 'project:manage-config')
    if (!can(actor, 'ai:code')) throw new ForbiddenError('Your role cannot use AI on code (ai:code).')
    const engine = (await listCodingEngines()).find((candidate) => candidate.id === data.engine)
    if (!engine) throw new BusinessRuleError(`The ${data.engine} engine is not configured.`)
    await assertWithinBudget({ projectId: ticket.projectId, provider: engine.id })

    const { createRepository } = await import('@/features/github/create-repo')
    let created: { repoId: string; fullName: string }
    try {
      created = await createRepository({
        actorId: actor.id,
        owner: data.owner,
        name: data.name,
        description: data.description || null,
        isPrivate: data.isPrivate,
        projectId: ticket.projectId,
      })
    } catch (error) {
      throw new BusinessRuleError((error as Error).message)
    }

    const run = await prisma.aiFixRun.create({
      data: {
        ticketId: ticket.id,
        repoId: created.repoId,
        requestedById: actor.id,
        provider: engine.id,
        model: await (async () => {
          const coder = await agentEngine('coder')
          return coder && coder.id === engine.id ? coder.model : engine.model
        })(),
        mode: 'SCAFFOLD',
      },
      select: { id: true },
    })
    after(() => executeFixRun(run.id))
    revalidatePath(`/tickets/${ticket.key}`)
    return ok({ repo: created.fullName, runId: run.id })
  })
}
