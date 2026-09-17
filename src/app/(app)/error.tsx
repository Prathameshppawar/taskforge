'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Safety net for anything that escapes a page's own guards.
 *
 * Next.js scrubs error messages in production, so nothing is shown from the
 * error itself beyond its digest — which is what correlates this screen with
 * the server log entry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[app] unhandled error:', error)
  }, [error])

  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page could not be loaded. Trying again often resolves it.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}

        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset}>
            <RotateCw className="size-4" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
