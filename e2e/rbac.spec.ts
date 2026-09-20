import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { signIn } from './helpers'
import { hashPassword } from '../src/infrastructure/auth/password'

/**
 * Delegated administration, and the two ways it can be walked around.
 *
 * Roles are data, so "who may grant what" is no longer decided by a compile-time
 * matrix — it is decided at runtime by the seniority ceiling and the
 * grant-what-you-hold rule. Those two checks are the entire difference between
 * delegation and privilege escalation, so they are asserted against a real
 * signed-in user rather than in isolation.
 */

const prisma = new PrismaClient()
const SUFFIX = Math.random().toString(36).slice(2, 8)
const LEAD_ROLE_KEY = `E2E_LEAD_${SUFFIX.toUpperCase()}`
const LEAD_USERNAME = `e2e-lead-${SUFFIX}`
const PASSWORD = 'LeadProbe!9x'

test.beforeAll(async () => {
  // A mid-ranked role: senior to User, junior to Project Manager. It can manage
  // roles and people, which is exactly the shape that makes escalation possible
  // if the ceiling is not enforced.
  const role = await prisma.role.create({
    data: {
      key: LEAD_ROLE_KEY,
      name: `Lead ${SUFFIX}`,
      description: 'Probe role for the delegation tests.',
      level: 30,
      isSystem: false,
      permissions: {
        create: [
          { permission: 'role:manage' },
          { permission: 'user:view' },
          { permission: 'user:create' },
          { permission: 'user:update' },
          { permission: 'team:manage-members' },
          { permission: 'project:view' },
          { permission: 'ticket:create' },
        ],
      },
    },
    select: { id: true },
  })

  await prisma.user.create({
    data: {
      username: LEAD_USERNAME,
      email: `${LEAD_USERNAME}@example.test`,
      name: `Lead Probe ${SUFFIX}`,
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
    },
  })
})

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: LEAD_USERNAME } })
  await prisma.role.deleteMany({ where: { key: { startsWith: `E2E_LEAD_${SUFFIX.toUpperCase()}` } } })
  await prisma.role.deleteMany({ where: { key: { startsWith: `E2E_ESCALATE_${SUFFIX.toUpperCase()}` } } })
  await prisma.$disconnect()
})

test('a delegated administrator sees only the roles they may act on', async ({ page }) => {
  await signIn(page, LEAD_USERNAME, PASSWORD)
  await page.goto('/workspace/roles')
  await page.waitForLoadState('networkidle')

  // Admin is the recovery role: openable, but only to look at.
  const adminRow = page.locator('li').filter({ hasText: 'recovery role' }).first()
  await expect(adminRow.getByRole('button', { name: 'View' })).toBeVisible()
  await expect(adminRow.getByRole('button', { name: 'Edit' })).toHaveCount(0)

  // Built-in roles can be reconfigured but never removed, so the delete control
  // stays inert even for someone who outranks them.
  const userRow = page.locator('li').filter({ hasText: 'Works on tickets' }).first()
  await expect(userRow.locator('button').last()).toBeDisabled()

  // And opening Admin offers nothing to save.
  await adminRow.getByRole('button', { name: 'View' }).click()
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  // `.first()` because the dialog's own dismiss icon is also named "Close".
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Close' }).first(),
  ).toBeVisible()
})

test('the role editor offers only permissions the author holds', async ({ page }) => {
  await signIn(page, LEAD_USERNAME, PASSWORD)
  await page.goto('/workspace/roles')
  await page.getByRole('button', { name: 'New role' }).click()

  // Held — so grantable.
  const grantable = page.locator('label').filter({ hasText: 'Add people' }).getByRole('checkbox')
  await expect(grantable).toBeEnabled()

  // Not held — so it cannot even be ticked. The server refuses it too; this is
  // the UI refusing to offer an action that would be rejected.
  const withheld = page
    .locator('label')
    .filter({ hasText: 'Act in every project' })
    .getByRole('checkbox')
  await expect(withheld).toBeDisabled()
})

test('the server refuses a role ranked at or above its author', async ({ page }) => {
  await signIn(page, LEAD_USERNAME, PASSWORD)
  await page.goto('/workspace/roles')
  await page.getByRole('button', { name: 'New role' }).click()

  const key = `E2E_ESCALATE_${SUFFIX.toUpperCase()}`
  await page.getByPlaceholder('Team Lead').fill('Escalation probe')
  await page.getByPlaceholder('TEAM_LEAD').fill(key)

  // Rank 0 is Admin's. The number input carries a `min`, so this is typed past
  // the client-side bound deliberately — the assertion is about the server.
  const rank = page.locator('input[type="number"]')
  await rank.fill('0')

  await page.getByRole('button', { name: 'Create role' }).click()

  // The refusal has to come back from the server and be shown. Asserting only
  // that no row appeared would also pass if the browser had quietly dropped the
  // request, which would prove nothing about the server's guard.
  await expect(
    page.getByText(/rank below your own|ranks at or above/i),
    'the server did not explain the refusal',
  ).toBeVisible({ timeout: 10_000 })

  const created = await prisma.role.findFirst({ where: { key } })
  expect(created, "a role was created at or above its author's rank").toBeNull()
})

test('a delegated administrator is not offered roles at or above their own', async ({ page }) => {
  await signIn(page, LEAD_USERNAME, PASSWORD)
  await page.goto('/workspace/people')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: /Add|New/ }).first().click()
  await page.waitForTimeout(600)

  // Open the role picker and read what it actually offers.
  await page.locator('button[role="combobox"]').last().click()
  await page.waitForTimeout(400)

  const offered = await page
    .locator('[role="option"]')
    .allTextContents()

  expect(offered.length, 'the picker offered nothing at all').toBeGreaterThan(0)
  expect(offered.join(' | '), 'Admin was offered to a junior administrator').not.toMatch(/\bAdmin\b/)
  expect(offered.join(' | '), 'Project Manager outranks this user').not.toMatch(/Project Manager/)
})
