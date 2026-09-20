import { redirect } from 'next/navigation'

/**
 * Moved out of Settings into the Workspace area.
 *
 * Kept as a redirect so bookmarks, links pasted into tickets and anything that
 * hard-coded the old path keep working.
 */
export default function SettingsTemplatesRedirect() {
  redirect('/workspace/templates')
}
