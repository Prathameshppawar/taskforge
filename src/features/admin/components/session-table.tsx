'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { UserAvatar } from '@/components/shared/user-avatar'
import { revokeUserSessionsAction } from '@/features/auth/actions'

export interface SessionRow {
  id: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
  userId: string
  name: string
  username: string
  avatarColor: string
  isActive: boolean
  age: string
}

/** Turns a user-agent string into something a human can scan. */
function describeClient(ua: string | null): string {
  if (!ua) return 'Unknown'
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser'
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : ''
  return os ? `${browser} on ${os}` : browser
}

export function SessionTable({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter()
  const [pendingUser, setPendingUser] = React.useState<string | null>(null)

  function revoke(row: SessionRow) {
    setPendingUser(row.userId)
    void (async () => {
      const result = await revokeUserSessionsAction(row.userId)
      setPendingUser(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${row.name} signed out of every device.`)
      router.refresh()
    })()
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9">User</TableHead>
            <TableHead className="h-9">Client</TableHead>
            <TableHead className="h-9">IP</TableHead>
            <TableHead className="h-9">Signed in</TableHead>
            <TableHead className="h-9 w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((row) => (
            <TableRow key={row.id} className={cn(row.revokedAt && 'opacity-50')}>
              <TableCell className="py-2">
                <span className="flex items-center gap-2">
                  <UserAvatar name={row.name} color={row.avatarColor} size="xs" />
                  <span className="truncate text-sm">{row.name}</span>
                  {row.revokedAt && <Badge variant="outline">Revoked</Badge>}
                  {!row.isActive && <Badge variant="outline">Deactivated</Badge>}
                </span>
              </TableCell>
              <TableCell className="py-2 text-xs text-muted-foreground">
                {describeClient(row.userAgent)}
              </TableCell>
              <TableCell className="py-2 font-mono text-[11px] text-muted-foreground">
                {row.ipAddress ?? '—'}
              </TableCell>
              <TableCell className="py-2 text-xs text-muted-foreground">{row.age}</TableCell>
              <TableCell className="py-2">
                {!row.revokedAt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 hover:text-destructive"
                    disabled={pendingUser === row.userId}
                    onClick={() => revoke(row)}
                    title={`Sign ${row.name} out everywhere`}
                    aria-label={`Sign ${row.name} out everywhere`}
                  >
                    {pendingUser === row.userId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <LogOut className="size-3.5" />
                    )}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
