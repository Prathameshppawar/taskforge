'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { colorClasses } from '@/core/domain/defaults'
import { RING_CLASSES } from '@/features/profile/role-colors'
import { avatarSrc, usePerson } from '@/components/shared/people-directory'
import { getInitials } from '@/lib/utils'
import { cn } from '@/lib/utils'

const SIZES = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-[11px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-20 text-2xl',
} as const

/** Small avatars get a thinner rim, or the ring swallows the face. */
const RING_WIDTHS = {
  xs: 'ring-[1.5px] ring-offset-1',
  sm: 'ring-[1.5px] ring-offset-1',
  md: 'ring-2 ring-offset-2',
  lg: 'ring-2 ring-offset-2',
  xl: 'ring-[3px] ring-offset-[3px]',
} as const

/**
 * A person's photo, or their initials on their colour, inside a rim coloured
 * by their role. Pass `userId` for the photo and the rim; without it this is
 * the initials alone, as before.
 */
export function UserAvatar({
  userId,
  name,
  color = 'slate',
  size = 'md',
  ring = true,
  className,
}: {
  userId?: string | null
  name: string
  color?: string
  size?: keyof typeof SIZES
  /** False where a rim would be noise, such as a dense picker list. */
  ring?: boolean
  className?: string
}) {
  const person = usePerson(userId)
  const rim = ring && person?.ring ? RING_CLASSES[person.ring] : undefined

  return (
    <Avatar
      className={cn(
        SIZES[size],
        rim && cn(RING_WIDTHS[size], 'ring-offset-background', rim),
        className,
      )}
      title={person ? `${name} · ${person.roleName}` : undefined}
    >
      {userId && person?.photo ? (
        <AvatarImage src={avatarSrc(userId, person.photo)} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback className={cn('font-medium text-white', colorClasses(color).dot)}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
