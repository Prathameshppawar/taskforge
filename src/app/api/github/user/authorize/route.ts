import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import { getCurrentUser } from '@/features/auth/guards'
import { authorizeUrl } from '@/features/github/user-auth'

/**
 * Sends a signed-in person to GitHub to connect their account. The random
 * `state` is also set as a cookie, and the callback refuses a code that does
 * not come back with it, so nobody can attach their GitHub account to someone
 * else's TaskForge session with a crafted link.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor) return NextResponse.redirect(new URL('/login', request.nextUrl.origin))
  const state = randomBytes(16).toString('hex')
  try {
    const response = NextResponse.redirect(await authorizeUrl(request.nextUrl.origin, state))
    response.cookies.set('gh_user_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      maxAge: 10 * 60,
      path: '/api/github/user',
    })
    return response
  } catch (error) {
    return NextResponse.redirect(new URL(`/workspace/integrations?error=${encodeURIComponent((error as Error).message)}`, request.nextUrl.origin))
  }
}
