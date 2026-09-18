import type { Metadata } from 'next'

import { requireUser } from '@/features/auth/guards'
import { listTokensAction } from '@/features/tokens/actions'
import { TokenManager } from '@/features/tokens/components/token-manager'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Access tokens' }

export default async function TokensPage() {
  await requireUser()
  const tokens = await listTokensAction()

  return (
    <div>
      <PageHeader
        title="Access tokens"
        description="For clients that cannot hold a browser session — the MCP server, scripts, CI."
      />
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <TokenManager tokens={tokens} />
      </div>
    </div>
  )
}
