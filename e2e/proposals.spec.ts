import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { signIn } from './helpers'

/**
 * Change proposals.
 *
 * The property worth proving is that an agent's write lands nowhere until a
 * person approves it: the tool call leaves the document untouched, the
 * proposal waits on the project's Proposals page, and only the Approve click
 * creates the version. A proposal overtaken by another edit must not be
 * applied by an ordinary click either.
 */

const prisma = new PrismaClient()
const SUFFIX = Math.random().toString(36).slice(2, 8)

let projectId: string
let projectCode: string

/** The same call an MCP client makes, with the browser session as the actor. */
async function propose(page: Page, name: string, body: string) {
  const response = await page.request.post('/api/mcp', {
    data: { tool: 'propose_document', arguments: { name, body, summary: 'Drafted by an agent' }, projectCode },
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as { ok: boolean; summary: string; data: { id: string; path: string } }
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  // The admin acts in every project; any live one will do.
  const project = await prisma.project.findFirstOrThrow({ where: { isArchived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, code: true } })
  projectId = project.id
  projectCode = project.code
})

test.afterAll(async () => {
  await prisma.projectChangeProposal.deleteMany({ where: { documentKey: { contains: SUFFIX } } })
  await prisma.projectDocument.deleteMany({ where: { kind: { contains: SUFFIX } } })
  await prisma.$disconnect()
})

test('a proposed document changes nothing until it is approved', async ({ page }) => {
  const key = `agent-notes-${SUFFIX}`
  const result = await propose(page, `Agent notes ${SUFFIX}`, '# Agent notes\n\nWritten by an agent, waiting for review.')

  expect(result.ok).toBe(true)
  expect(result.summary).toContain('PENDING APPROVAL')
  expect(await prisma.projectDocument.count({ where: { projectId, kind: key } })).toBe(0)

  await page.goto(`/projects/${projectId}/proposals`)
  await expect(page.getByRole('link', { name: /Proposals\s*\d+/ })).toBeVisible()
  await page.getByRole('link', { name: new RegExp(`Agent notes ${SUFFIX}`) }).click()
  await expect(page.getByText('+ # Agent notes')).toBeVisible()

  await page.getByRole('button', { name: 'Approve and apply' }).click()
  await expect(page.getByText(/^Approved by /)).toBeVisible()

  const version = await prisma.projectDocument.findFirstOrThrow({ where: { projectId, kind: key }, select: { version: true, source: true } })
  expect(version).toEqual({ version: 1, source: 'PROPOSAL' })

  await page.goto(`/projects/${projectId}/docs`)
  await expect(page.getByRole('link', { name: new RegExp(`Agent notes ${SUFFIX}`) })).toBeVisible()
})

test('a proposal overtaken by another edit needs "Approve anyway"', async ({ page }) => {
  const key = `runbook-${SUFFIX}`
  const result = await propose(page, `Runbook ${SUFFIX}`, '# Runbook\n\nRestart the worker, then check the queue.')
  expect(result.ok).toBe(true)

  // Someone writes the document by hand while the proposal waits.
  await prisma.projectDocument.create({
    data: { projectId, kind: key, version: 1, title: `Runbook ${SUFFIX}`, body: '# Runbook\n\nWritten by hand meanwhile.', source: 'EDIT' },
  })

  await page.goto(result.data.path)
  await expect(page.getByText(/written against version 0; the document is now at version 1/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve and apply' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Approve anyway' }).click()
  await expect(page.getByText(/^Approved by /)).toBeVisible()
  expect(await prisma.projectDocument.count({ where: { projectId, kind: key } })).toBe(2)
})

test('an approved details proposal is applied and audited under both names', async ({ page }) => {
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { description: true } })
  const description = `Rewritten by an agent ${SUFFIX}.`
  try {
    const response = await page.request.post('/api/mcp', {
      data: { tool: 'propose_project_update', arguments: { description }, projectCode },
    })
    const result = (await response.json()) as { ok: boolean; data: { path: string } }
    expect(result.ok).toBe(true)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { description: true } })).description).toBe(before.description)

    await page.goto(result.data.path)
    await expect(page.getByText(description)).toBeVisible()
    await page.getByRole('button', { name: 'Approve and apply' }).click()
    await expect(page.getByText(/^Approved by /)).toBeVisible()

    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { description: true } })).description).toBe(description)
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { projectId, summary: { contains: 'approving' } }, orderBy: { createdAt: 'desc' } })
    expect(entry.summary).toMatch(/updated project details, approving .+'s proposal/)
  } finally {
    await prisma.project.update({ where: { id: projectId }, data: { description: before.description } })
    await prisma.projectChangeProposal.deleteMany({ where: { projectId, kind: 'PROJECT_DETAILS', payload: { path: ['description'], equals: description } } })
  }
})
