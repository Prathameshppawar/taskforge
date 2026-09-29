import type { Metadata } from 'next'

import { prisma } from '@/infrastructure/db/prisma'
import { requireUser } from '@/features/auth/guards'
import { githubConnection } from '@/features/github/user-auth'
import { GithubAccount } from '@/features/github/components/github-account'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'GitHub' }

export default async function GithubSettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const actor = await requireUser()
  const [{ connected, error }, connection, app] = await Promise.all([
    searchParams,
    githubConnection(actor.id),
    prisma.githubApp.findUnique({ where: { id: 1 }, select: { id: true } }),
  ])
  return (
    <div>
      <PageHeader title="GitHub" description="Your own GitHub connection, for creating repositories." />
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        {connected && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">Connected as <strong>{connected}</strong>.</p>}
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {error === 'state' ? 'That link did not start here, so it was refused. Try again.' : error}
          </p>
        )}
        <GithubAccount connection={connection} appReady={Boolean(app) || Boolean(process.env.GITHUB_CLIENT_ID)} />
      </div>
    </div>
  )
}
