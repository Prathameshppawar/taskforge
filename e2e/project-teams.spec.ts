import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { signIn } from './helpers'
import { hashPassword } from '../src/infrastructure/auth/password'

/**
 * Staffing a project by attaching a team.
 *
 * The behaviour worth proving is not that a row can be written — it is that
 * access genuinely follows the team. Somebody who is in no project directly
 * must gain access when their team is attached, and lose it when it is
 * detached, without anybody touching their account.
 */

const prisma = new PrismaClient()
const SUFFIX = Math.random().toString(36).slice(2, 8)
const TEAM_NAME = `E2E Team ${SUFFIX}`
const USERNAME = `e2e-team-${SUFFIX}`
const PASSWORD = 'TeamProbe!7z'

let teamId: string
let projectId: string
let projectName: string

test.beforeAll(async () => {
  const role = await prisma.role.findFirstOrThrow({ where: { key: 'USER' } })
  const user = await prisma.user.create({
    data: {
      username: USERNAME,
      email: `${USERNAME}@example.test`,
      name: `Team Probe ${SUFFIX}`,
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
    },
    select: { id: true },
  })

  const team = await prisma.team.create({
    data: {
      name: TEAM_NAME,
      description: 'Probe team for the project attachment tests.',
      members: { create: [{ userId: user.id, isManager: false }] },
    },
    select: { id: true },
  })
  teamId = team.id

  // A project this person is not a member of, and does not own.
  const project = await prisma.project.findFirstOrThrow({
    where: { isArchived: false, members: { none: { userId: user.id } } },
    select: { id: true, name: true },
  })
  projectId = project.id
  projectName = project.name
})

test.afterAll(async () => {
  await prisma.projectTeam.deleteMany({ where: { teamId } })
  await prisma.team.deleteMany({ where: { id: teamId } })
  await prisma.user.deleteMany({ where: { username: USERNAME } })
  await prisma.$disconnect()
})

test.describe.configure({ mode: 'serial' })

test('without a team, the project is not visible', async ({ page }) => {
  await signIn(page, USERNAME, PASSWORD)
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')

  await expect(
    page.getByText(projectName, { exact: true }),
    'the probe user should not see a project they are not on',
  ).toHaveCount(0)
})

test('attaching the team grants its members access', async ({ page }) => {
  await prisma.projectTeam.create({
    data: { projectId, teamId, role: 'MEMBER' },
  })

  await signIn(page, USERNAME, PASSWORD)
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')

  await expect(
    page.getByText(projectName, { exact: true }).first(),
    'access did not follow the attached team',
  ).toBeVisible()

  // And the project itself opens, rather than merely appearing in a list.
  await page.goto(`/projects/${projectId}/board`)
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board`))
})

test('the members screen shows the team and who it brings', async ({ page }) => {
  await signIn(page)
  await page.goto(`/projects/${projectId}/members`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByText(TEAM_NAME)).toBeVisible()
  await expect(page.getByText(`Team Probe ${SUFFIX}`).first()).toBeVisible()
})

test('detaching the team takes the access away again', async ({ page }) => {
  await prisma.projectTeam.deleteMany({ where: { projectId, teamId } })

  await signIn(page, USERNAME, PASSWORD)
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')

  await expect(
    page.getByText(projectName, { exact: true }),
    'access outlived the team attachment',
  ).toHaveCount(0)
})
