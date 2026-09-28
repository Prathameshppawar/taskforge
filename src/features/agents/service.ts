import { prisma } from '@/infrastructure/db/prisma'

/**
 * AI agents as workspace members.
 *
 * Each agent is an ordinary user row marked `isAgent`, so everything that
 * already works for people works for it unchanged: it authors comments, it is
 * named in the activity log, it can be @-mentioned and filtered by, and a
 * report of who spent what lists it like anyone else. What it cannot do is sign
 * in — `authorize` refuses agent accounts before looking at a password, and the
 * stored hash is not a hash of anything.
 *
 * Created on first use rather than seeded, so a deployment that never uses AI
 * never grows these accounts, and one that does needs no extra step.
 */

export type AgentKind = 'coder' | 'planner' | 'reviewer' | 'release' | 'triage' | 'ops'

export const AGENTS: Record<AgentKind, { username: string; name: string; jobTitle: string; avatarColor: string }> = {
  coder: { username: 'ai-coder', name: 'TaskForge Coder', jobTitle: 'Writes fixes as pull requests', avatarColor: 'violet' },
  planner: { username: 'ai-planner', name: 'TaskForge Planner', jobTitle: 'Plans changes before they are built', avatarColor: 'indigo' },
  reviewer: { username: 'ai-reviewer', name: 'TaskForge Reviewer', jobTitle: 'Reviews pull requests against their ticket', avatarColor: 'sky' },
  release: { username: 'ai-release', name: 'TaskForge Release Manager', jobTitle: 'Drafts release notes', avatarColor: 'teal' },
  triage: { username: 'ai-triage', name: 'TaskForge Triage', jobTitle: 'Files and sorts incoming problems', avatarColor: 'amber' },
  ops: { username: 'ai-ops', name: 'TaskForge Ops', jobTitle: 'Watches production and opens incidents', avatarColor: 'rose' },
}

const AGENT_ROLE = { key: 'AI_AGENT', name: 'AI agent', description: 'Automated TaskForge agents. Cannot sign in.', level: 90 }

/** Not a bcrypt hash of anything, so no password can ever match it. */
const UNUSABLE_HASH = '!agent-account-no-password'

const cache = new Map<AgentKind, string>()

/** The agent's user id, creating the account (and its role) on first use. */
export async function agentUserId(kind: AgentKind): Promise<string> {
  const cached = cache.get(kind)
  if (cached) return cached

  const meta = AGENTS[kind]
  const role = await prisma.role.upsert({
    where: { key: AGENT_ROLE.key },
    create: AGENT_ROLE,
    update: {},
    select: { id: true },
  })
  const user = await prisma.user.upsert({
    where: { username: meta.username },
    create: {
      username: meta.username,
      email: `${meta.username}@agents.taskforge.invalid`,
      name: meta.name,
      jobTitle: meta.jobTitle,
      avatarColor: meta.avatarColor,
      passwordHash: UNUSABLE_HASH,
      roleId: role.id,
      isAgent: true,
    },
    update: { isAgent: true },
    select: { id: true },
  })
  cache.set(kind, user.id)
  return user.id
}

/** Posts a ticket comment as an agent. */
export async function agentComment(kind: AgentKind, ticketId: string, body: string) {
  const authorId = await agentUserId(kind)
  return prisma.comment.create({ data: { ticketId, authorId, body }, select: { id: true } })
}
