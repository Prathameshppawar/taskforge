import { test, expect } from '@playwright/test'

import { signIn, firstProjectId, allPages, pageOverflow } from './helpers'

/**
 * The app shell is a fixed-height column: the header stays put and only the
 * content pane scrolls. When that breaks the whole document scrolls instead,
 * which drags the header and sidebar off-screen and feels broken on every page
 * at once.
 *
 * It has broken three separate ways — a flex child without `min-h-0`, a Radix
 * ScrollArea root missing `overflow-hidden`, and a Tailwind `sr-only` label
 * escaping its clipper — so the invariant is asserted rather than assumed.
 */

const VIEWPORTS = [
  // Short desktop windows are where the shell is most likely to give: there is
  // the least room, so any element refusing to shrink shows up immediately.
  { label: 'desktop 1400x420', width: 1400, height: 420 },
  { label: 'desktop 1400x600', width: 1400, height: 600 },
  { label: 'desktop 1400x900', width: 1400, height: 900 },
  // Below `lg` the sidebar is replaced by the mobile nav — a different layout,
  // and one no automated check covered before.
  { label: 'tablet 768x1024', width: 768, height: 1024 },
  { label: 'phone 390x844', width: 390, height: 844 },
]

for (const viewport of VIEWPORTS) {
  test(`content scrolls inside its pane, not the page — ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await signIn(page)

    const projectId = await firstProjectId(page)
    const failures: string[] = []

    for (const target of allPages(projectId)) {
      await page.goto(target.path)
      await page.waitForLoadState('networkidle')

      const overflow = await pageOverflow(page)
      if (overflow) {
        failures.push(
          `${target.name} (${target.path}) — ${overflow.axis} overflow: ` +
            `${overflow.scroll}px in a ${overflow.viewport}px viewport.\n` +
            `      caused by ${overflow.culprit}`,
        )
      }
    }

    expect(failures, `Page-level overflow at ${viewport.label}:\n  - ${failures.join('\n  - ')}`).toEqual([])
  })
}

test('the sidebar scrolls internally when it is taller than the window', async ({ page }) => {
  // The regression this guards: the nav grew the page instead of scrolling, so
  // the projects at the bottom of a long list became unreachable.
  await page.setViewportSize({ width: 1400, height: 500 })
  await signIn(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const sidebar = await page.evaluate(() => {
    const nav = document.querySelector('aside nav')
    if (!nav) return null

    // The ScrollArea viewport is the scrolling ancestor of the nav.
    let element: HTMLElement | null = nav.parentElement
    while (element && getComputedStyle(element).overflowY === 'visible') {
      element = element.parentElement
    }
    if (!element) return null

    return {
      visible: Math.round(element.clientHeight),
      content: Math.round(nav.getBoundingClientRect().height),
      scrollable: element.scrollHeight > element.clientHeight,
    }
  })

  expect(sidebar, 'no sidebar found — desktop layout should render one').not.toBeNull()
  expect(
    sidebar!.visible,
    'the sidebar pane grew past the window instead of scrolling inside it',
  ).toBeLessThanOrEqual(500)
  expect(sidebar!.scrollable, 'sidebar content overflows but the pane does not scroll').toBe(true)
})
