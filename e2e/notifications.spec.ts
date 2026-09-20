import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { signIn, ADMIN } from './helpers'

/**
 * The bell polls rather than streams, and chimes only when the unread count
 * rises. Both halves are easy to break silently: a chime on every poll is
 * maddening, and a chime that never fires is indistinguishable from a working
 * one until somebody misses something.
 *
 * Audio cannot be heard from a test, so the Web Audio API is stubbed and the
 * oscillators the chime would have played are counted instead.
 */

/*
 * Serial, not parallel. Every test here drives the one shared admin account's
 * sound preference, which now lives in the database rather than in a per-context
 * localStorage — so two workers running these at once would flip the column out
 * from under each other.
 */
test.describe.configure({ mode: 'serial' })

const prisma = new PrismaClient()
const created: string[] = []

/**
 * Put the chime back on before every test.
 *
 * The preference is a column on the user, not browser storage, so muting no
 * longer evaporates with the browser context — a muting test would otherwise
 * leave the account silent and every later run of the chime tests would fail
 * for a reason that has nothing to do with the code under test.
 */
async function setSound(enabled: boolean) {
  await prisma.user.update({
    where: { username: ADMIN.username },
    data: { notificationSound: enabled },
  })
}

test.beforeEach(async () => {
  await setSound(true)
})

test.afterAll(async () => {
  if (created.length) await prisma.notification.deleteMany({ where: { id: { in: created } } })
  // Leave the shared development account as we found it.
  await setSound(true)
  await prisma.$disconnect()
})

/** Records oscillator starts so the test can tell whether a chime was played. */
async function stubAudio(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __chimes: number }).__chimes = 0

    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      resume() {
        return Promise.resolve()
      }
      close() {
        return Promise.resolve()
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect: (target: unknown) => target,
        }
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect: (target: unknown) => target,
          start: () => {
            ;(window as unknown as { __chimes: number }).__chimes++
          },
          stop() {},
        }
      }
    }

    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
  })
}

async function raiseUnread(page: import('@playwright/test').Page) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN.username } })
  const notification = await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'MENTIONED',
      title: `E2E probe ${Date.now()}`,
      body: 'Raised by the notification sound test.',
    },
  })
  created.push(notification.id)

  // The bell re-polls whenever the tab becomes visible, which is a far shorter
  // wait than its 60-second timer.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
}

test('a new notification raises the badge and plays the chime', async ({ page }) => {
  await stubAudio(page)
  await signIn(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const before = await page.evaluate(() => (window as unknown as { __chimes: number }).__chimes)
  expect(before, 'nothing should have chimed on first load').toBe(0)

  await raiseUnread(page)

  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __chimes: number }).__chimes),
      { message: 'no chime after the unread count rose', timeout: 15_000 },
    )
    .toBeGreaterThan(0)

  await expect(page.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible()
})

test('a poll that finds nothing new stays silent', async ({ page }) => {
  await stubAudio(page)
  await signIn(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Three polls, no new rows: the count is unchanged, so nothing should sound.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(400)
  }

  const chimes = await page.evaluate(() => (window as unknown as { __chimes: number }).__chimes)
  expect(chimes, 'the bell chimed without anything new arriving').toBe(0)
})

test('muting is saved to the account, not just the browser', async ({ page }) => {
  await stubAudio(page)
  await signIn(page)
  await page.goto('/dashboard')

  await page.getByRole('button', { name: /Notifications/ }).click()

  const mute = page.getByRole('button', { name: 'Mute notification sound' })
  await expect(mute, 'sound should default to on').toBeVisible()
  await mute.click()

  await expect(page.getByRole('button', { name: 'Unmute notification sound' })).toBeVisible()

  // The point of moving this off localStorage: the choice is on the account, so
  // it is visible to the server and to every other device this person uses.
  await expect
    .poll(
      async () =>
        (
          await prisma.user.findUniqueOrThrow({
            where: { username: ADMIN.username },
            select: { notificationSound: true },
          })
        ).notificationSound,
      { message: 'muting did not reach the database' },
    )
    .toBe(false)

  await page.reload()
  await page.getByRole('button', { name: /Notifications/ }).click()
  await expect(
    page.getByRole('button', { name: 'Unmute notification sound' }),
    'the mute preference did not survive a reload',
  ).toBeVisible()

  // And a muted bell must stay silent when something does arrive.
  await raiseUnread(page)
  await page.waitForTimeout(1500)
  const chimes = await page.evaluate(() => (window as unknown as { __chimes: number }).__chimes)
  expect(chimes, 'muted bell still played a sound').toBe(0)

  // The settings screen is the other surface onto the same column; if the two
  // disagree, one of them is lying to the person reading it.
  await page.goto('/settings/notifications')
  await expect(page.getByRole('switch', { name: 'Notification sound' })).toHaveAttribute(
    'data-state',
    'unchecked',
  )
})

test('the settings screen can play the chime while the preference is off', async ({ page }) => {
  await stubAudio(page)
  await setSound(false)
  await signIn(page)
  await page.goto('/settings/notifications')

  // "Hear it" exists precisely so a muted person can audition what they would
  // be turning on. Gating it on the preference would make it useless.
  await page.getByRole('button', { name: 'Hear it' }).click()

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __chimes: number }).__chimes), {
      message: 'the test button did not play while muted',
    })
    .toBeGreaterThan(0)
})
