import { requireUser } from '@/features/auth/guards'
import { SETTINGS_SECTIONS, visibleSections } from '@/features/settings/modules'
import { ModuleNav } from '@/components/shared/module-nav'

/**
 * The settings shell.
 *
 * Your account and nothing else — name, notifications, password, tokens.
 * Workspace administration used to share this shell; it now lives at
 * `/workspace`, reachable from the sidebar, because "how am I set up?" and
 * "how is this organisation set up?" are different questions asked by
 * different people at different times.
 *
 * This layout owns the scrolling. The modules render plain content, so there is
 * exactly one scroll container and the header never leaves the screen.
 */
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireUser()
  const sections = visibleSections(SETTINGS_SECTIONS, actor.permissions)

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <ModuleNav sections={sections} exact={['/settings']} />

      {/* `relative` for the same reason the app shell needs it: a stray
          absolutely positioned descendant must be clipped here, not escape to
          the document. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
