'use client'

import { cn } from '@/lib/utils'
import { COLOR_TOKENS, colorClasses } from '@/core/domain/defaults'

export function ColorPicker({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (color: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} role="radiogroup" aria-label="Colour">
      {COLOR_TOKENS.map((token) => (
        <button
          key={token}
          type="button"
          role="radio"
          aria-checked={value === token}
          aria-label={token}
          onClick={() => onChange(token)}
          className={cn(
            'size-6 rounded-md transition-transform hover:scale-110',
            colorClasses(token).dot,
            value === token && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
          )}
        />
      ))}
    </div>
  )
}
