import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { authConfig } from '@/auth.config'

/**
 * Route protection.
 *
 * Runs on the Edge runtime using only the JWT — no database, no bcrypt. This is
 * a fast UX gate; it is NOT the authorization boundary. Every Server Action
 * independently re-checks the caller's permissions.
 */
const { auth } = NextAuth(authConfig)

/** Paths reachable without a session. */
const PUBLIC_PATHS = ['/login']

/** Reachable while a forced password change is outstanding. */
const PASSWORD_CHANGE_PATH = '/settings/security'

export default auth((request) => {
  const { nextUrl } = request
  const { pathname } = nextUrl
  const session = request.auth

  // Auth.js and the cron endpoint authenticate themselves.
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    // Bearer-token authenticated; a redirect to /login would be nonsense here.
    pathname.startsWith('/api/mcp')
  ) {
    return NextResponse.next()
  }

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )

  if (!session?.user) {
    if (isPublic) return NextResponse.next()

    /*
     * An API route must answer with JSON, not a redirect. Sending 307 to /login
     * makes fetch follow it and receive an HTML page where it expected JSON,
     * which surfaces as a parse error rather than "you are not signed in".
     */
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized. Sign in, or send Authorization: Bearer <token>.' },
        { status: 401 },
      )
    }

    const loginUrl = new URL('/login', nextUrl.origin)
    // Preserve where they were heading so login can return them there.
    if (pathname !== '/') loginUrl.searchParams.set('callbackUrl', pathname + nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // Signed in — keep them out of the login screen.
  if (isPublic) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl.origin))
  }

  /*
   * An admin password reset sets `mustChangePassword`. Everything is blocked
   * until it is cleared, except the change-password screen itself — checking
   * the pathname here is exactly why this lives in middleware rather than in
   * the app layout, which would otherwise redirect to itself forever.
   */
  if (session.user.mustChangePassword && pathname !== PASSWORD_CHANGE_PATH) {
    const url = new URL(PASSWORD_CHANGE_PATH, nextUrl.origin)
    url.searchParams.set('forced', '1')
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
