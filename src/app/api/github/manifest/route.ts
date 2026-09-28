import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import { getCurrentUser, can } from '@/features/auth/guards'
import { buildManifest, manifestTarget } from '@/features/github/manifest'

/**
 * Starts GitHub App creation.
 *
 * GitHub only accepts a manifest as a browser form POST to its own page, so
 * this answers with a tiny page that submits one. The `state` is a random
 * value also set as a cookie; the callback refuses any code that does not come
 * back with it, which is what stops somebody else's app being attached to this
 * workspace by a crafted link.
 */
export const dynamic = 'force-dynamic'

const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export async function GET(request: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || !can(actor, 'integration:manage')) {
    return NextResponse.json({ error: 'You cannot manage integrations.' }, { status: 403 })
  }

  const organization = request.nextUrl.searchParams.get('org')?.trim() || null
  if (organization && !ORG_PATTERN.test(organization)) {
    return NextResponse.json({ error: 'That is not a GitHub organisation name.' }, { status: 400 })
  }

  const origin = request.nextUrl.origin
  const state = randomBytes(16).toString('hex')
  // A suffix, because app names are unique across all of GitHub and "TaskForge"
  // is taken by the first person to try. Not the TaskForge username: that is
  // meaningless on GitHub, where the app is seen. Editable on GitHub's form.
  const name = `TaskForge ${organization ? `${organization} ` : ''}${state.slice(0, 4)}`
  const manifest = JSON.stringify(buildManifest(origin, name))

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Creating GitHub App…</title></head>
<body style="font-family:system-ui;padding:2rem">
<p>Taking you to GitHub to create the app…</p>
<form id="f" method="post" action="${escapeHtml(manifestTarget(organization, state))}">
<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
<noscript><button type="submit">Continue to GitHub</button></noscript>
</form>
<script>document.getElementById('f').submit()</script>
</body></html>`

  const response = new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  response.cookies.set('gh_manifest_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https:'),
    maxAge: 15 * 60,
    path: '/api/github',
  })
  return response
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
