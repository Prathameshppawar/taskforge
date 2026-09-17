import { cn } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'

/** Small coloured dot used in status/priority/label pickers. */
export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', colorClasses(color).dot, className)}
      aria-hidden
    />
  )
}

export function StatusBadge({
  name,
  color,
  className,
}: {
  name: string
  color: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        colorClasses(color).badge,
        className,
      )}
    >
      <ColorDot color={color} />
      {name}
    </span>
  )
}

/** Priority shown as a small bar chart — level is 1..5. */
export function PriorityBadge({
  name,
  color,
  level,
  showLabel = true,
  className,
}: {
  name: string
  color: string
  level: number
  showLabel?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap', className)}
      title={`Priority: ${name}`}
    >
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={cn(
              'w-[3px] rounded-[1px] transition-colors',
              step === 1 && 'h-1.5',
              step === 2 && 'h-2',
              step === 3 && 'h-2.5',
              step === 4 && 'h-3',
              step === 5 && 'h-3.5',
              step <= level ? colorClasses(color).bar : 'bg-muted-foreground/20',
            )}
          />
        ))}
      </span>
      {showLabel && <span className="text-muted-foreground">{name}</span>}
      <span className="sr-only">Priority {name}</span>
    </span>
  )
}

export function LabelChip({
  name,
  color,
  className,
  onRemove,
}: {
  name: string
  color: string
  className?: string
  onRemove?: () => void
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        colorClasses(color).badge,
        className,
      )}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
          aria-label={`Remove label ${name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

export function TypeBadge({
  name,
  color,
  className,
}: {
  name: string
  color: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      <ColorDot color={color} className="size-1.5" />
      <span className="text-muted-foreground">{name}</span>
    </span>
  )
}
