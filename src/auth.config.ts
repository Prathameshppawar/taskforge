import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe Auth.js configuration.
 *
 * This half of the config carries NO database access and NO bcrypt, so it can
 * run inside middleware on the Edge runtime. The Credentials provider and the
 * database revalidation logic live in `src/auth.ts`, which only ever executes in
 * the Node runtime (Server Components, Server Actions, Route Handlers).
 */
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: Number(process.env.SESSION_MAX_AGE ?? 28800),
  },

  trustHost: true,

  providers: [],

  callbacks: {
    /**
     * Cheap, token-only gate used by middleware. It decides *routing*, not
     * authorization — every Server Action re-checks permissions independently.
     */
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user)
      const { pathname } = request.nextUrl

      const isPublic =
        pathname === '/login' ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/cron')

      if (isPublic) return true
      return isLoggedIn
    },

    /**
     * Runs on every token read. When `user` is present this is a fresh sign-in;
     * otherwise the existing token is passed through untouched. The Node-side
     * config in `src/auth.ts` extends this with periodic database revalidation.
     */
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string
        token.username = user.username
        token.role = user.role
        token.isActive = user.isActive
        token.mustChangePassword = user.mustChangePassword
        token.avatarColor = user.avatarColor
        token.sessionVersion = user.sessionVersion
        token.checkedAt = Date.now()
      }

      // Allows the client to refresh the token after a self-service password
      // change without forcing a full sign-out.
      if (trigger === 'update' && session) {
        if (typeof session.mustChangePassword === 'boolean') {
          token.mustChangePassword = session.mustChangePassword
        }
        if (typeof session.name === 'string') token.name = session.name
      }

      return token
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.username = token.username
        session.user.role = token.role
        session.user.isActive = token.isActive
        session.user.mustChangePassword = token.mustChangePassword
        session.user.avatarColor = token.avatarColor
      }
      return session
    },
  },
} satisfies NextAuthConfig
