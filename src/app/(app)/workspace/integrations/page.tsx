import type { Metadata } from 'next'

import { requirePermissionPage } from '@/features/auth/guards'
import { getIntegrationOverview } from '@/features/github/queries'
import { GithubIntegration } from '@/features/github/components/github-integration'
import { vercelStatus } from '@/features/vercel/service'
import { VercelCard } from '@/features/vercel/components/vercel-card'
import { getInboundOverview } from '@/features/inbound-email/queries'
import { EmailInCard } from '@/features/inbound-email/components/email-in-card'
import { teamsStatus } from '@/infrastructure/msteams/client'
import { TeamsCard } from '@/features/msteams/components/teams-card'
import { WebhooksCard } from '@/features/webhooks-out/components/webhooks-card'
import { queueSummary } from '@/features/jobs/queue'
import { prisma } from '@/infrastructure/db/prisma'
import { headers } from 'next/headers'
import { PageHeader } from '@/components/shared/page-header'

export const metadata: Metadata = { title: 'Integrations' }

/** Why a GitHub round trip came back without connecting, in plain words. */
const ERRORS: Record<string, string> = {
  forbidden: 'Your role cannot manage integrations.',
  'missing-code': 'GitHub did not send a code back. Try creating the app again.',
  'state-mismatch':
    'That link did not start here, so it was refused. Start again from the button below.',
  'conversion-failed':
    'GitHub created the app but would not hand over its credentials — the code may have expired. Try again.',
  'missing-installation': 'GitHub did not say which installation was changed.',
  'sync-failed': 'The app was installed, but listing its repositories failed. Press Refresh.',
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; installed?: string }>
}) {
  await requirePermissionPage('integration:manage')
  const [{ error, installed }, overview, vercel, inbound, teams, channels, headerList, hooks, projects, jobs] = await Promise.all([
    searchParams,
    getIntegrationOverview(),
    vercelStatus(),
    getInboundOverview(),
    teamsStatus(),
    prisma.msTeamsConversation.findMany({
      where: { kind: 'channel', projectId: { not: null } },
      select: { name: true, project: { select: { name: true } } },
      take: 20,
    }),
    headers(),
    prisma.outboundWebhook.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, url: true, events: true, active: true, lastStatus: true, lastError: true, lastDeliveredAt: true, project: { select: { name: true } } },
    }),
    prisma.project.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    queueSummary(),
  ])
  const origin = `${headerList.get('x-forwarded-proto') ?? 'https'}://${headerList.get('host')}`

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect the tools where the work actually happens."
      />
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {ERRORS[error] ?? 'Something went wrong connecting GitHub.'}
          </p>
        )}
        {installed && (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
            Connected <strong>{installed}</strong>. Link repositories to projects from each
            project&rsquo;s settings.
          </p>
        )}
        <GithubIntegration overview={overview} />
        <VercelCard status={vercel} />
        <EmailInCard overview={inbound} />
        <TeamsCard
          status={teams}
          endpoint={`${origin}/api/msteams/messages`}
          channels={channels.map((channel) => ({ name: channel.name, project: channel.project?.name ?? null }))}
        />
        <WebhooksCard
          apiBase={origin}
          projects={projects}
          jobs={jobs}
          hooks={hooks.map(({ project, ...hook }) => ({ ...hook, project: project?.name ?? null }))}
        />
      </div>
    </div>
  )
}
