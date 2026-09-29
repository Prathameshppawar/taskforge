import { lookup } from 'node:dns/promises'

import { prisma } from '@/infrastructure/db/prisma'
import { asInstallation } from '@/infrastructure/github/client'
import { checkMonitorUrl, isPrivateAddress } from '@/core/domain/network'
import { clip, htmlToText, isTextAttachment, parseGithubLink } from '@/core/domain/ticket-context'

/**
 * Everything on a ticket an agent should read before it starts.
 *
 * The description is rarely the whole story. The conversation holds the
 * clarifications, attachments hold the logs and specs, resource links hold the
 * design and the docs, and the parent says what this is part of. All of it is
 * gathered here, within budgets — a 5 MB log must not push the ticket itself
 * out of the context — and all of it is labelled as material, not instructions.
 *
 * Links are read only where that is safe: a GitHub file in a repository the app
 * can see is read through the app; any other link only if it is a public http(s)
 * page, checked by the same rules as an uptime monitor. Figma, SharePoint and
 * anything behind a sign-in are listed, not fetched.
 */

const TOTAL_BUDGET = 60_000
const PER_ITEM = 15_000
const FETCH_TIMEOUT_MS = 8_000

export async function gatherTicketContext(ticketId: string, installationId: bigint | null): Promise<string | null> {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: {
      remarks: true,
      parent: { select: { key: true, title: true, description: true } },
      linksOut: { select: { type: true, target: { select: { key: true, title: true } } } },
      linksIn: { select: { type: true, source: { select: { key: true, title: true } } } },
      comments: {
        where: { deletedAt: null, author: { isAgent: false } },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: { body: true, createdAt: true, author: { select: { name: true } } },
      },
      resources: { select: { name: true, type: true, url: true, notes: true } },
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: { filename: true, contentType: true, size: true, data: { select: { content: true } } },
      },
    },
  })

  const sections: string[] = []
  let used = 0
  const add = (title: string, body: string) => {
    if (used >= TOTAL_BUDGET) return
    const text = clip(body.trim(), Math.min(PER_ITEM, TOTAL_BUDGET - used))
    if (!text) return
    used += text.length
    sections.push(`### ${title}\n${text}`)
  }

  if (ticket.remarks) add('Remarks', ticket.remarks)
  if (ticket.parent) {
    add(`Parent ticket ${ticket.parent.key}`, `${ticket.parent.title}\n${ticket.parent.description ?? ''}`)
  }
  const links = [
    ...ticket.linksOut.map((link) => `${link.type.toLowerCase().replace('_', ' ')} ${link.target.key}: ${link.target.title}`),
    ...ticket.linksIn.map((link) => `${link.source.key} ${link.type.toLowerCase().replace('_', ' ')} this: ${link.source.title}`),
  ]
  if (links.length) add('Linked tickets', links.map((line) => `- ${line}`).join('\n'))

  // People's comments only: an agent's own earlier output is not new evidence.
  if (ticket.comments.length) {
    add(
      'Conversation',
      ticket.comments.map((comment) => `${comment.author.name} (${comment.createdAt.toISOString().slice(0, 10)}): ${comment.body}`).join('\n\n'),
    )
  }

  for (const attachment of ticket.attachments) {
    if (!attachment.data) continue
    if (isTextAttachment(attachment.filename, attachment.contentType)) {
      add(`Attachment ${attachment.filename}`, Buffer.from(attachment.data.content).toString('utf8'))
    } else {
      add(`Attachment ${attachment.filename}`, `(${attachment.contentType}, ${attachment.size} bytes — not text, so not included)`)
    }
  }

  for (const resource of ticket.resources) {
    const label = `Resource "${resource.name}" (${resource.type.toLowerCase()}) — ${resource.url}`
    const text = await readResource(resource.url, installationId)
    add(label, [resource.notes, text ?? '(could not be read here — it may need a sign-in; treat the link as a reference)'].filter(Boolean).join('\n\n'))
  }

  return sections.length ? sections.join('\n\n') : null
}

async function readResource(url: string, installationId: bigint | null): Promise<string | null> {
  const github = parseGithubLink(url)
  if (github && installationId) {
    const repo = `/repos/${github.owner}/${github.repo}`
    try {
      if (github.path) {
        const file = await asInstallation<{ content?: string; encoding?: string }>(
          installationId,
          `${repo}/contents/${github.path.split('/').map(encodeURIComponent).join('/')}${github.ref ? `?ref=${encodeURIComponent(github.ref)}` : ''}`,
        )
        return file.content ? Buffer.from(file.content, 'base64').toString('utf8') : null
      }
      const readme = await asInstallation<{ content?: string }>(installationId, `${repo}/readme`)
      return readme.content ? Buffer.from(readme.content, 'base64').toString('utf8') : null
    } catch {
      // Not a repository the app can see; fall through to a public fetch.
    }
  }
  return fetchPublicText(url)
}

/** A public page's text, by the same rules as an uptime check, or null. */
async function fetchPublicText(raw: string): Promise<string | null> {
  const checked = checkMonitorUrl(raw)
  if (!checked.ok) return null
  try {
    const addresses = await lookup(checked.url.hostname, { all: true })
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) return null
    const response = await fetch(checked.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'TaskForge-Agent/1.0', Accept: 'text/html,text/plain,application/json;q=0.9' },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? ''
    if (!/text|json|xml|markdown/i.test(type)) return null
    const body = (await response.text()).slice(0, 400_000)
    return /html/i.test(type) ? htmlToText(body) : body
  } catch {
    return null
  }
}
