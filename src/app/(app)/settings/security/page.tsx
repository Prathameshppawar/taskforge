import type { Metadata } from 'next'
import { ShieldAlert } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { ChangePasswordForm } from '@/features/auth/components/change-password-form'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Security' }

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ forced?: string }>
}) {
  await requireUser()
  const { forced } = await searchParams
  const isForced = forced === '1'

  return (
    <div>
      <PageHeader
        title="Security"
        description="Change the password used to sign in to your workspace."
      />

      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        {isForced && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium">A password change is required</p>
              <p className="mt-0.5 text-muted-foreground">
                An administrator reset your password. Choose a new one to continue.
              </p>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              You will stay signed in on this device after changing it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm forced={isForced} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
