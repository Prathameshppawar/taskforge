import type { Page } from '@playwright/test'

export const ADMIN = {
  username: process.env.E2E_USERNAME ?? 'admin',
  password: process.env.E2E_PASSWORD ?? 'ChangeMe!2024',
}

export async function signIn(page: Page, username = ADMIN.username, password = ADMIN.password) {
  await page.goto('/login')
  await page.fill('input[autocomplete="username"]', username)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** The first project the signed-in user can open, for project-scoped views. */
export async function firstProjectId(page: Page): Promise<string> {
  await page.goto('/projects')
  const href = await page
    .locator('a[href^="/projects/"]')
    .first()
    .getAttribute('href')

  const id = href?.split('/projects/')[1]?.split('/')[0]
  if (!id) throw new Error('No project visible to this user — is the database seeded?')
  return id
}

/** Every routable page worth checking for layout regressions. */
export function allPages(projectId: string): Array<{ name: string; path: string }> {
  return [
    { name: 'dashboard', path: '/dashboard' },
    { name: 'my-tickets', path: '/my-tickets' },
    { name: 'projects', path: '/projects' },
    { name: 'inbox', path: '/inbox' },
    ...['board', 'table', 'tree', 'calendar', 'timeline', 'insights', 'labels', 'members'].map(
      (view) => ({ name: view, path: `/projects/${projectId}/${view}` }),
    ),
    // The settings area has its own nested layout with a second scroll
    // container, which is exactly the shape that produced the last three
    // containment bugs.
    ...['', '/notifications', '/security', '/tokens'].map((module) => ({
      name: `settings${module || '/profile'}`,
      path: `/settings${module}`,
    })),
    // Workspace administration moved out of Settings into its own area.
    ...['/people', '/roles', '/teams', '/sessions'].map((module) => ({
      name: `workspace${module}`,
      path: `/workspace${module}`,
    })),
  ]
}

export interface Overflow {
  axis: 'vertical' | 'horizontal'
  scroll: number
  viewport: number
  culprit: string
}

/**
 * Reports page-level overflow *and what caused it*.
 *
 * The bare assertion — document taller than the window — says a regression
 * happened but not where, and the causes are genuinely obscure: a flex child
 * missing `min-h-0`, a scroll container that never got `overflow-hidden`, or an
 * absolutely positioned element whose containing block sits outside the clipper
 * so it escapes every ancestor. Finding the last one by hand took six passes,
 * so the check names the element instead of leaving it to be rediscovered.
 */
export async function pageOverflow(page: Page): Promise<Overflow | null> {
  return page.evaluate(() => {
    const root = document.documentElement

    const describe = (element: Element): string => {
      const tag = element.tagName.toLowerCase()
      const cls = (element.className || '').toString().trim().split(/\s+/).slice(0, 4).join('.')
      const parent = element.parentElement
      const offsetParent = (element as HTMLElement).offsetParent
      const escapes =
        getComputedStyle(element).position === 'absolute' &&
        (offsetParent === document.body || offsetParent === null)

      return [
        `<${tag}${cls ? '.' + cls : ''}>`,
        `inside <${parent?.tagName.toLowerCase() ?? '?'}>`,
        escapes
          ? '— absolutely positioned with no positioned ancestor, so it escapes every overflow:hidden above it (Tailwind `sr-only` does this)'
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    }

    /** The element reaching furthest past the edge that nothing above it clips. */
    const worst = (axis: 'vertical' | 'horizontal'): string => {
      const limit = axis === 'vertical' ? window.innerHeight : window.innerWidth
      let best: { element: Element; past: number } | null = null

      for (const element of Array.from(document.querySelectorAll('*'))) {
        const rect = element.getBoundingClientRect()
        if (rect.height === 0 && rect.width === 0) continue

        const edge = axis === 'vertical' ? rect.bottom : rect.right
        if (edge <= limit + 1) continue

        // Does anything actually clip it? An absolute element whose containing
        // block is the body is clipped by nothing, however many
        // `overflow:hidden` ancestors it appears to sit under.
        const style = getComputedStyle(element)
        const offsetParent = (element as HTMLElement).offsetParent
        const unclippable =
          style.position === 'absolute' && (offsetParent === document.body || offsetParent === null)

        if (!unclippable) {
          let ancestor = element.parentElement
          let clipped = false
          while (ancestor && ancestor !== document.body) {
            const overflow = getComputedStyle(ancestor)
            const prop = axis === 'vertical' ? overflow.overflowY : overflow.overflowX
            if (prop !== 'visible') {
              clipped = true
              break
            }
            ancestor = ancestor.parentElement
          }
          if (clipped) continue
        }

        const past = edge - limit
        if (!best || past > best.past) best = { element, past }
      }

      return best ? describe(best.element) : '(no single element — check body/html sizing)'
    }

    if (root.scrollHeight > window.innerHeight + 1) {
      return {
        axis: 'vertical' as const,
        scroll: root.scrollHeight,
        viewport: window.innerHeight,
        culprit: worst('vertical'),
      }
    }

    if (root.scrollWidth > window.innerWidth + 1) {
      return {
        axis: 'horizontal' as const,
        scroll: root.scrollWidth,
        viewport: window.innerWidth,
        culprit: worst('horizontal'),
      }
    }

    return null
  })
}
