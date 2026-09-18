'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'

const SIZES = {
  xs: 'size-3 rounded-[3px]',
  sm: 'size-5 rounded-[4px]',
  md: 'size-8 rounded-lg',
  lg: 'size-9 rounded-lg',
} as const

/**
 * A project's visual identity.
 *
 * Renders the logo when one is set, and falls back to the colour swatch
 * otherwise — including when the image fails to load. A remote URL the platform
 * does not control can 404, move, or be blocked by a network policy, and a
 * broken-image icon in the sidebar looks worse than the swatch it replaced.
 */
export function ProjectLogo({
  name,
  color,
  logoUrl,
  size = 'md',
  className,
}: {
  name: string
  color: string
  logoUrl?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => setFailed(false), [logoUrl])

  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        onError={() => setFailed(true)}
        className={cn(
          SIZES[size],
          'shrink-0 object-cover ring-1 ring-border',
          className,
        )}
      />
    )
  }

  return (
    <span
      className={cn(SIZES[size], 'shrink-0', colorClasses(color).dot, className)}
      aria-hidden
      title={name}
    />
  )
}
