import Link from 'next/link'

import { requireUser } from '@/features/auth/guards'
import { APP_NAME } from '@/lib/env'
import { UserMenu } from '@/components/shared/user-menu'

/**
 * The client portal's own shell: no sidebar, no board, no administration —
 * the three things a client does not need and should not be shown. Staff can
 * open it too, to see exactly what their client sees.
 */
export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireUser()
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/portal" className="font-semibold">
            {APP_NAME} <span className="font-normal text-muted-foreground">· Client portal</span>
          </Link>
          <div className="flex items-center gap-3">
            {actor.roleKey !== 'CLIENT' && (
              <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">
                Back to the workspace
              </Link>
            )}
            <UserMenu name={actor.name} username={actor.username} roleName={actor.roleName} avatarColor={actor.avatarColor} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  )
}
