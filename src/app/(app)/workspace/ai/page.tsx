import type { Metadata } from 'next'

import { requirePermissionPage } from '@/features/auth/guards'
import { getAiAdminPage } from '@/features/ai-admin/queries'
import { AiAdmin } from '@/features/ai-admin/components/ai-admin'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'AI' }
// Model lists are fetched live from each provider.
export const dynamic = 'force-dynamic'

export default async function AiPage() {
  await requirePermissionPage('ai:manage')
  const data = await getAiAdminPage()

  return (
    <div>
      <PageHeader
        title="AI"
        description="Which engines and models the workspace uses, what they cost, and who hears about it."
      />
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <AiAdmin data={data} />
      </div>
    </div>
  )
}
