import { redirect } from 'next/navigation'

/** Long-standing alias. Points at the Workspace area since the move. */
export default function AdminTemplatesRedirect() {
  redirect('/workspace/templates')
}
