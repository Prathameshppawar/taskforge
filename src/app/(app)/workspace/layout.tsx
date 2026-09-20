import { redirect } from 'next/navigation'

import { requireUser } from '@/features/auth/guards'
import { visibleSections } from '@/features/settings/modules'
import { WORKSPACE_SECTIONS } from '@/features/workspace/modules'
import { ModuleNav } from '@/components/shared/module-nav'

/**
 * The workspace shell.
 *
 * Administration of the organisation itself: who is here, what they may do,
 * how they are grouped, and what new projects start from. Each module names
 * the permission that reveals it, so two administrators with different grants
 * see different navigation without either list being written twice.
 *
 * Someone with none of those permissions has no modules at all, and is sent
 * away rather than shown an empty shell. The sidebar already hides the entry
 * for them, so reaching here means a typed URL or a stale link.
 *
 * This layout owns the scrolling. The modules render plain content, so there is
 * exactly one scroll container and the header never leaves the screen.
 */
export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireUser()
  const sections = visibleSections(WORKSPACE_SECTIONS, actor.permissions)

  if (sections.length === 0) redirect('/forbidden')

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <ModuleNav sections={sections} />

      {/* `relative` for the same reason the app shell needs it: a stray
          absolutely positioned descendant must be clipped here, not escape to
          the document. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
