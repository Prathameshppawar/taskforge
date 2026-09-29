'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { setEmailPreferenceAction } from '../actions'

type Preference = 'emailNotifications' | 'emailDigest'

/**
 * Which emails reach this person. The manager switch is shown only to someone
 * who manages a project, because nobody else is ever sent those emails.
 */
export function EmailPreferences({
  emailConfigured,
  address,
  notifications,
  digest,
  managesProjects,
}: {
  emailConfigured: boolean
  address: string
  notifications: boolean
  digest: boolean
  managesProjects: boolean
}) {
  return (
    <div className="space-y-4">
      {!emailConfigured && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Email is not set up on this deployment (EMAIL_HOST), so nothing is sent yet.
          Your choices are kept for when it is.
        </p>
      )}

      <EmailSwitch
        id="email-notifications"
        preference="emailNotifications"
        initial={notifications}
        label="Email my notifications"
        description={`Send a copy of each notification to ${address}: assigned to you, mentioned, replied to, or a ticket you follow is blocked.`}
      />

      {managesProjects && (
        <EmailSwitch
          id="email-digest"
          preference="emailDigest"
          initial={digest}
          label="Manager emails"
          description="For projects you manage: a digest every Monday (done, started, overdue, blocked, stalled), and an alert when a production issue or top-priority ticket is raised."
        />
      )}
    </div>
  )
}

function EmailSwitch({
  id,
  preference,
  initial,
  label,
  description,
}: {
  id: string
  preference: Preference
  initial: boolean
  label: string
  description: string
}) {
  const router = useRouter()
  const [enabled, setEnabled] = React.useState(initial)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => setEnabled(initial), [initial])

  async function change(next: boolean) {
    setEnabled(next)
    setSaving(true)
    const result = await setEmailPreferenceAction(preference, next)
    setSaving(false)

    if (!result.success) {
      setEnabled(!next)
      toast.error(result.error)
      return
    }

    toast.success(`${label}: ${next ? 'on' : 'off'}.`)
    router.refresh()
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={saving}
        onCheckedChange={change}
        aria-label={label}
      />
    </div>
  )
}
