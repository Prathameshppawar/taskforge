import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'No access' }

const REASONS: Record<string, string> = {
  admin: 'This area is restricted to administrators.',
  permission: 'Your role does not include this capability.',
  project: 'You are not a member of this project, or it is private.',
}

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const actor = await requireUser()
  const { reason } = await searchParams

  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <ShieldAlert className="size-6 text-muted-foreground" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">You do not have access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {REASONS[reason ?? ''] ?? 'You do not have permission to view this page.'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          You are signed in as {actor.name} ({actor.roleName}). If this looks wrong,
          ask an administrator to adjust your access.
        </p>

        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/my-tickets">My tickets</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
