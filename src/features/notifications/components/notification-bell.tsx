'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  AtSign,
  Bell,
  CheckCheck,
  MessageSquare,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  fetchNotificationsAction,
  markAllReadAction,
  markNotificationReadAction,
  setNotificationSoundAction,
} from '../actions'
import type { NotificationItem } from '../queries'
import { useNotificationSound } from './use-notification-sound'

const ICONS = {
  MENTIONED: AtSign,
  ASSIGNED: UserPlus,
  COMMENT_REPLY: MessageSquare,
  TICKET_BLOCKED: Bell,
} as const

/**
 * Notification bell.
 *
 * Polls rather than streams: the count query is a single indexed COUNT, and a
 * websocket for an internal tool of this size would be infrastructure to
 * maintain for no benefit. Polling pauses while the tab is hidden, so a forgotten
 * background tab does not keep hitting the database all day.
 */
const POLL_MS = 60_000

export function NotificationBell({
  initialUnread,
  soundEnabled,
}: {
  initialUnread: number
  soundEnabled: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [unread, setUnread] = React.useState(initialUnread)
  const [items, setItems] = React.useState<NotificationItem[]>([])
  const [loading, setLoading] = React.useState(false)

  /*
   * The mute button is optimistic. The preference lives on the account, so the
   * truthful value is the prop — but waiting for a round trip and a layout
   * re-render before the icon changes makes a mute button feel broken. Local
   * state leads, and re-syncs to the prop whenever the server disagrees.
   */
  const [soundOn, setSoundOn] = React.useState(soundEnabled)
  React.useEffect(() => setSoundOn(soundEnabled), [soundEnabled])

  const play = useNotificationSound(soundOn)

  const toggleSound = React.useCallback(() => {
    const next = !soundOn
    setSoundOn(next)
    void setNotificationSoundAction(next).then((result) => {
      // Refused or failed — snap back rather than show a lie.
      if (!result.success) setSoundOn(!next)
      else router.refresh()
    })
  }, [soundOn, router])

  // The chime is held in a ref so that muting it does not re-create the poll
  // interval — that would reset the timer on every toggle.
  const playRef = React.useRef(play)
  React.useEffect(() => {
    playRef.current = play
  }, [play])

  /**
   * The last count we showed. A chime means *new work arrived*, so it fires
   * only when the count rises. Reading a notification in another tab lowers it,
   * and marking all read zeroes it; neither should make a sound.
   */
  const lastUnread = React.useRef(initialUnread)

  const applyUnread = React.useCallback((next: number) => {
    lastUnread.current = next
    setUnread(next)
  }, [])

  const refresh = React.useCallback(async () => {
    const result = await fetchNotificationsAction()
    setItems(result.items)
    // Opening the panel is a deliberate act — never chime for what it finds.
    applyUnread(result.unread)
  }, [applyUnread])

  React.useEffect(() => {
    let cancelled = false

    async function poll() {
      if (document.visibilityState !== 'visible' || cancelled) return
      const result = await fetchNotificationsAction().catch(() => null)
      if (!result || cancelled) return

      if (result.unread > lastUnread.current) playRef.current()
      lastUnread.current = result.unread
      setUnread(result.unread)
    }

    const timer = setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    void refresh().finally(() => setLoading(false))
  }, [open, refresh])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground tabular-nums">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={toggleSound}
              aria-pressed={soundOn}
              aria-label={soundOn ? 'Mute notification sound' : 'Unmute notification sound'}
              title={soundOn ? 'Sound on' : 'Sound off'}
            >
              {soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </Button>

          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[11px]"
              onClick={async () => {
                await markAllReadAction()
                await refresh()
                router.refresh()
              }}
            >
              <CheckCheck className="size-3" />
              Mark all read
            </Button>
          )}
          </div>
        </div>

        <ScrollArea className="max-h-96">
          {loading && items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nothing yet. You will be told when someone mentions you or assigns you a ticket.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const Icon = ICONS[item.type] ?? Bell
                const href = item.ticket ? `/tickets/${item.ticket.key}` : '/inbox'

                return (
                  <li key={item.id}>
                    <Link
                      href={href}
                      onClick={async () => {
                        setOpen(false)
                        if (!item.readAt) {
                          await markNotificationReadAction(item.id)
                          setUnread((n) => {
                            const next = Math.max(0, n - 1)
                            lastUnread.current = next
                            return next
                          })
                        }
                      }}
                      className={cn(
                        'flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent',
                        !item.readAt && 'bg-primary/5',
                      )}
                    >
                      {item.actor ? (
                        <UserAvatar
                          name={item.actor.name}
                          color={item.actor.avatarColor}
                          size="sm"
                          className="mt-0.5 shrink-0"
                        />
                      ) : (
                        <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-snug">{item.title}</p>
                        {item.body && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {item.body}
                          </p>
                        )}
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                        </p>
                      </div>

                      {!item.readAt && (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>

        <div className="border-t px-3 py-2">
          <Link
            href="/inbox"
            onClick={() => setOpen(false)}
            className="text-[11px] text-primary hover:underline"
          >
            See everything →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
