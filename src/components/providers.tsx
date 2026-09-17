'use client'

import * as React from 'react'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Client providers.
 *
 * SessionProvider is required for `useSession().update()`, which the
 * change-password flow uses to clear the forced-change flag on the live token
 * without making the user sign in again.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NextThemesProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </NextThemesProvider>
    </SessionProvider>
  )
}
