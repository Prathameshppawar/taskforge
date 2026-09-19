import { redirect } from 'next/navigation'

/** Administration moved into Settings. Kept so existing links still resolve. */
export default function MovedPage() {
  redirect('/settings/sessions')
}
