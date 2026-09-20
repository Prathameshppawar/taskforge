'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Play, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { setNotificationSoundAction } from '../actions'
import { useNotificationChime } from './use-notification-sound'

/**
 * The notification preferences panel.
 *
 * The "Hear it" button is not decoration. The chime only ever fires when
 * *someone else* mentions or assigns you — you are filtered out of your own
 * notifications — so without this button the only way to audition the sound is
 * to sign in as a second person and have them poke you. A setting nobody can
 * sample is a setting nobody can make an informed choice about.
 */
export function NotificationPreferences({ soundEnabled }: { soundEnabled: boolean }) {
  const router = useRouter()
  const chime = useNotificationChime()

  const [enabled, setEnabled] = React.useState(soundEnabled)
  const [saving, setSaving] = React.useState(false)

  // The server is the source of truth; re-sync if it sends a different value
  // (for instance after muting from the bell in the header).
  React.useEffect(() => setEnabled(soundEnabled), [soundEnabled])

  async function change(next: boolean) {
    setEnabled(next)
    setSaving(true)

    // Switching it on plays the chime straight away. The click is also the
    // gesture that unblocks the browser's autoplay policy, so this doubles as
    // the moment the audio context becomes usable for the rest of the session.
    if (next) chime()

    const result = await setNotificationSoundAction(next)
    setSaving(false)

    if (!result.success) {
      setEnabled(!next)
      toast.error(result.error)
      return
    }

    toast.success(next ? 'Notification sound on.' : 'Notification sound off.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="notification-sound" className="text-sm font-medium">
            Notification sound
          </Label>
          <p className="text-xs text-muted-foreground">
            Play a short chime when someone mentions you, assigns you a ticket, or
            replies to your comment. Follows your account, so muting here mutes
            everywhere you sign in.
          </p>
        </div>

        <Switch
          id="notification-sound"
          checked={enabled}
          disabled={saving}
          onCheckedChange={change}
          aria-label="Notification sound"
        />
      </div>

      <div className="flex items-center gap-2 border-t pt-4">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={chime}>
          <Play className="size-3.5" />
          Hear it
        </Button>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {enabled ? (
            <Volume2 className="size-3.5 shrink-0" />
          ) : (
            <VolumeX className="size-3.5 shrink-0" />
          )}
          {enabled
            ? 'You will hear this when new work arrives.'
            : 'Muted — you will still see the badge on the bell.'}
        </p>
      </div>
    </div>
  )
}
