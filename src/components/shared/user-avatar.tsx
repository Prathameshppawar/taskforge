import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { colorClasses } from '@/core/domain/defaults'
import { getInitials } from '@/lib/utils'
import { cn } from '@/lib/utils'

const SIZES = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-[11px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const

export function UserAvatar({
  name,
  color = 'slate',
  size = 'md',
  className,
}: {
  name: string
  color?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <Avatar className={cn(SIZES[size], className)}>
      <AvatarFallback
        className={cn('font-medium text-white', colorClasses(color).dot)}
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
