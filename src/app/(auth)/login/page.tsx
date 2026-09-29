import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { KanbanSquare } from 'lucide-react'

import { getCurrentUser } from '@/features/auth/guards'
import { LoginForm } from '@/features/auth/components/login-form'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { APP_NAME } from '@/lib/env'
import { signIn } from '@/auth'
import { ssoOptions } from '@/features/sso/providers'
import { Button } from '@/components/ui/button'

const SSO_ERRORS: Record<string, string> = {
  'no-account': 'That account is not in this workspace. Ask your administrator to add you with the same email.',
  unverified: 'Your provider has not verified that email address, so it cannot be used to sign in.',
  inactive: 'Your account has been deactivated.',
}

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  const { callbackUrl, error } = await searchParams
  const sso = ssoOptions()

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-muted/30 p-4">
      {/* Ambient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--color-primary)/12%,transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.025] [background-image:linear-gradient(var(--color-foreground)_1px,transparent_1px),linear-gradient(90deg,var(--color-foreground)_1px,transparent_1px)] [background-size:44px_44px]"
      />

      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <KanbanSquare className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your workspace
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {error && SSO_ERRORS[error] && (
            <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              {SSO_ERRORS[error]}
            </p>
          )}
          {sso.length > 0 && (
            <div className="mb-5 space-y-2">
              {sso.map((option) => (
                <form
                  key={option.id}
                  action={async () => {
                    'use server'
                    await signIn(option.id, { redirectTo: callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : '/dashboard' })
                  }}
                >
                  <Button type="submit" variant="outline" className="w-full">
                    Continue with {option.label}
                  </Button>
                </form>
              ))}
              <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or with your username <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}
          <LoginForm callbackUrl={callbackUrl} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accounts are provisioned by your administrator.
          <br />
          Contact them if you cannot sign in.
        </p>
      </div>
    </main>
  )
}
