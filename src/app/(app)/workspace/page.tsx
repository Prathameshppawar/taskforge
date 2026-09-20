import { redirect } from 'next/navigation'

import { requireUser } from '@/features/auth/guards'
import { visibleSections } from '@/features/settings/modules'
import { WORKSPACE_SECTIONS } from '@/features/workspace/modules'

/**
 * `/workspace` itself has no content — it forwards to the first module this
 * person may actually open.
 *
 * Which module that is depends on their grants, so there is no single sensible
 * static landing page: an administrator who may only manage teams would be
 * shown a People page they cannot read.
 */
export default async function WorkspacePage() {
  const actor = await requireUser()
  const sections = visibleSections(WORKSPACE_SECTIONS, actor.permissions)
  const first = sections[0]?.modules[0]

  redirect(first ? first.href : '/forbidden')
}
