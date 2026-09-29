import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/infrastructure/db/prisma'
import { getCurrentUser } from '@/features/auth/guards'
import { recordActivity } from '@/features/activity/service'
import { exchangeCode } from '@/features/github/user-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const back = (query: string) => NextResponse.redirect(new URL(`/settings/github?${query}`, request.nextUrl.origin))
  const actor = await getCurrentUser()
  if (!actor) return NextResponse.redirect(new URL('/login', request.nextUrl.origin))

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expected = request.cookies.get('gh_user_state')?.value
  if (!code || !state || !expected || state !== expected) return back('error=state')

  try {
    const login = await exchangeCode(actor.id, code, request.nextUrl.origin)
    await recordActivity(prisma, {
      action: 'UPDATED',
      entityType: 'INTEGRATION',
      entityId: actor.id,
      entityLabel: actor.name,
      actorId: actor.id,
      summary: `connected their GitHub account (${login})`,
    })
    const response = back(`connected=${encodeURIComponent(login)}`)
    response.cookies.delete({ name: 'gh_user_state', path: '/api/github/user' })
    return response
  } catch (error) {
    console.error('[github] user authorisation failed:', error)
    return back(`error=${encodeURIComponent((error as Error).message.slice(0, 120))}`)
  }
}
