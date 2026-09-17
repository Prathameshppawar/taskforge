'use client'

import * as React from 'react'
import Link from 'next/link'
import { LogOut, Settings, User as UserIcon } from 'lucide-react'
import type { RoleKey } from '@prisma/client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/shared/user-avatar'
import { ROLE_LABELS } from '@/core/domain/rbac'
import { logoutAction } from '@/features/auth/actions'

export function UserMenu({
  name,
  username,
  role,
  avatarColor,
}: {
  name: string
  username: string
  role: RoleKey
  avatarColor: string
}) {
  const [isPending, startTransition] = React.useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <UserAvatar name={name} color={avatarColor} size="md" />
        <span className="sr-only">Open account menu</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">@{username}</span>
            <span className="mt-1 w-fit rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ROLE_LABELS[role]}
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserIcon className="size-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/security">
            <Settings className="size-4" /> Change password
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={isPending}
          onSelect={(event) => {
            // Keep the menu mounted while the sign-out action runs.
            event.preventDefault()
            startTransition(async () => {
              await logoutAction()
            })
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
