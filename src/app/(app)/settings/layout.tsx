import { requireUser } from '@/features/auth/guards'
import { visibleSections } from '@/features/settings/modules'
import { SettingsNav } from '@/features/settings/components/settings-nav'

/**
 * The settings shell.
 *
 * Account and workspace administration live in one place rather than scattered
 * across the main navigation, because they answer the same question — "how is
 * this set up?" — and because the modules an individual can see depend entirely
 * on their permissions, which makes a single gated list far easier to reason
 * about than five separate top-level entries.
 *
 * This layout owns the scrolling. The modules render plain content, so there is
 * exactly one scroll container and the header never leaves the screen.
 */
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireUser()
  const sections = visibleSections(actor.permissions)

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <SettingsNav sections={sections} />

      {/* `relative` for the same reason the app shell needs it: a stray
          absolutely positioned descendant must be clipped here, not escape to
          the document. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
