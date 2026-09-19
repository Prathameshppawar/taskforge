import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { signIn } from './helpers'
import { hashPassword } from '../src/infrastructure/auth/password'

/**
 * Every account an admin creates or resets starts with `mustChangePassword`,
 * so this flow is the first thing a new colleague ever sees. It is also the
 * flow most prone to breaking invisibly: the gate has to let exactly one page
 * through, and a gate that redirects to itself produces an infinite loop that
 * nothing else in the app would reveal.
 */

const prisma = new PrismaClient()
const SUFFIX = Math.random().toString(36).slice(2, 8)
const USERNAME = `e2e-pw-${SUFFIX}`
const INITIAL = 'Initial!Pass9'
const REPLACEMENT = 'Replaced!Pass9'

test.beforeAll(async () => {
  const role = await prisma.role.findFirstOrThrow({ where: { key: 'USER' } })
  await prisma.user.create({
    data: {
      username: USERNAME,
      email: `${USERNAME}@example.test`,
      name: 'Forced Change Probe',
      passwordHash: await hashPassword(INITIAL),
      roleId: role.id,
      mustChangePassword: true,
    },
  })
})

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USERNAME } })
  await prisma.$disconnect()
})

test.describe.configure({ mode: 'serial' })

test('a first sign-in is forced to the change-password screen and cannot escape it', async ({
  page,
}) => {
  await signIn(page, USERNAME, INITIAL)

  await expect(page).toHaveURL(/\/settings\/security\?forced=1/)

  // The gate must hold against navigation, not merely redirect once. This is
  // the assertion that would have caught the redirect loop, and equally would
  // catch a gate that lets the user walk straight past it.
  for (const path of ['/dashboard', '/projects', '/my-tickets']) {
    await page.goto(path)
    await expect(page, `${path} should bounce back to the password screen`).toHaveURL(
      /\/settings\/security/,
    )
  }
})

test('setting a new password releases the gate and the new password works', async ({
  page,
  browser,
}) => {
  await signIn(page, USERNAME, INITIAL)
  await expect(page).toHaveURL(/\/settings\/security/)

  await page.fill('input[name="currentPassword"]', INITIAL)
  await page.fill('input[name="newPassword"]', REPLACEMENT)
  await page.fill('input[name="confirmPassword"]', REPLACEMENT)
  await page.click('button[type="submit"]')

  // The flag must clear in the database, not just in the session — otherwise
  // the next sign-in traps them again.
  await expect
    .poll(
      async () =>
        (await prisma.user.findUnique({ where: { username: USERNAME } }))?.mustChangePassword,
      { message: 'mustChangePassword never cleared', timeout: 15_000 },
    )
    .toBe(false)

  // And the session must be usable immediately, without a forced sign-out.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  // A genuinely separate session, rather than clearing cookies on this one:
  // the signed-in page can still be served from the back/forward cache, which
  // makes a cleared cookie look like it never took effect.
  const fresh = await browser.newContext()
  try {
    const freshPage = await fresh.newPage()
    await signIn(freshPage, USERNAME, REPLACEMENT)

    // Straight into the app — not back to the change-password screen.
    await expect(freshPage).toHaveURL(/\/dashboard/)
  } finally {
    await fresh.close()
  }
})
