import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests.
 *
 * These cover what the domain suite structurally cannot: layout, and flows that
 * span a redirect. `npm run verify` proves the rules are right; this proves the
 * app is usable.
 *
 * Chrome rather than bundled Chromium so a developer can run the suite without
 * a 150MB download; CI installs the same channel explicitly.
 */
export default defineConfig({
  testDir: './e2e',
  // A layout regression is never flaky, and a retry would only hide a real one.
  retries: 0,
  fullyParallel: true,
  // One worker locally keeps the shared seed data predictable across specs.
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],

  /*
   * Tests run against a production build, not `next dev`. Development mode
   * renders extra overlays and does not tree-shake, so a layout bug can appear
   * or disappear between the two — and it is the production build that ships.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start',
        url: 'http://localhost:3000/login',
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
})
