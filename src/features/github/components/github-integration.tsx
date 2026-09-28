'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  CircleAlert,
  ExternalLink,
  Github,
  Globe,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Webhook,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  forgetGithubAppAction,
  refreshGithubAction,
  setWebhookUrlAction,
} from '../actions'
import type { IntegrationOverview } from '../queries'

/**
 * The workspace's GitHub connection, in the order it is set up: create the
 * app, install it on an account, give GitHub somewhere to send events.
 */
export function GithubIntegration({ overview }: { overview: IntegrationOverview }) {
  if (overview.credentialError) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{overview.credentialError}</Notice>
        <ForgetApp />
      </div>
    )
  }

  if (!overview.configured) return <CreateApp />

  return (
    <div className="space-y-8">
      <AppSummary overview={overview} />
      <Installations overview={overview} />
      <WebhookSettings current={overview.webhookUrl} />
    </div>
  )
}

// -----------------------------------------------------------------------------

function CreateApp() {
  const [org, setOrg] = React.useState('')
  const [target, setTarget] = React.useState<'personal' | 'org'>('personal')

  const href =
    target === 'org' && org.trim()
      ? `/api/github/manifest?org=${encodeURIComponent(org.trim())}`
      : '/api/github/manifest'

  return (
    <section className="space-y-4 rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Github className="size-5" />
        </span>
        <div className="space-y-1">
          <h2 className="font-semibold">Connect GitHub</h2>
          <p className="text-sm text-muted-foreground">
            TaskForge creates its own GitHub App. You confirm on GitHub, choose which
            repositories it may see, and it links branches, pull requests and CI results to
            tickets from then on. It asks for read access only.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Where should the app live?</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['personal', 'My GitHub account', 'Covers every repository you own.'],
              ['org', 'An organisation', 'You must be an owner of it.'],
            ] as const
          ).map(([value, title, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTarget(value)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                target === value ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
              )}
            >
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </button>
          ))}
        </div>
        {target === 'org' && (
          <Input
            value={org}
            onChange={(event) => setOrg(event.target.value)}
            placeholder="organisation-name"
            className="max-w-xs font-mono text-sm"
            aria-label="GitHub organisation"
          />
        )}
      </div>

      <Button asChild disabled={target === 'org' && !org.trim()}>
        {/* A plain link, not a fetch: the route answers with a page that posts
            the manifest to GitHub, which only a top-level navigation can do. */}
        <a href={href}>
          <Github className="size-4" />
          Create GitHub App
        </a>
      </Button>

      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>GitHub shows a pre-filled form. Rename the app if you like, then create it.</li>
        <li>GitHub asks where to install it. Pick <strong>All repositories</strong> or a few.</li>
        <li>You land back here with those repositories listed.</li>
      </ol>
    </section>
  )
}

function AppSummary({ overview }: { overview: IntegrationOverview }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const app = overview.app

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Github className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {app?.name}
          <Badge variant="secondary" className="text-[10px]">
            {overview.source === 'env' ? 'from environment' : 'stored, sealed'}
          </Badge>
        </p>
        <p className="text-xs text-muted-foreground">
          App #{app?.appId}
          {app?.ownerLogin ? ` · owned by ${app.ownerLogin}` : ''} · read-only: contents, pull
          requests, checks
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {app?.htmlUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={`${app.htmlUrl}/installations/new`} target="_blank" rel="noreferrer">
              <Plus className="size-4" />
              Install on another account
            </a>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await refreshGithubAction()
              if (!result.success) {
                toast.error(result.error)
                return
              }
              toast.success(
                `${result.data.installations} ${result.data.installations === 1 ? 'account' : 'accounts'}, ${result.data.repos} repositories.`,
              )
              router.refresh()
            })
          }
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
        {overview.source === 'database' && <ForgetApp />}
      </div>
    </section>
  )
}

function Installations({ overview }: { overview: IntegrationOverview }) {
  if (overview.installations.length === 0) {
    return (
      <Notice tone="warn">
        The app exists but is not installed anywhere yet, so it cannot see any repositories.{' '}
        {overview.app?.htmlUrl && (
          <a
            className="font-medium underline"
            href={`${overview.app.htmlUrl}/installations/new`}
          >
            Install it
          </a>
        )}
      </Notice>
    )
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Connected accounts</h2>
        <p className="text-xs text-muted-foreground">
          Link a repository to a project from that project&rsquo;s settings. One project can
          span several repositories, and one repository can serve several projects.
        </p>
      </div>

      {overview.installations.map((installation) => {
        const inactive = installation.removedAt || installation.suspendedAt
        return (
          <div key={installation.id} className="rounded-xl border">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              {installation.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={installation.avatarUrl} alt="" className="size-6 rounded-full" />
              )}
              <span className="font-medium">{installation.accountLogin}</span>
              <Badge variant="outline" className="text-[10px]">
                {installation.accountType === 'Organization' ? 'Organisation' : 'Personal'}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {installation.repositorySelection === 'all'
                  ? 'All repositories, including new ones'
                  : 'Selected repositories'}
              </Badge>
              {inactive && (
                <Badge variant="destructive" className="text-[10px]">
                  {installation.removedAt ? 'Uninstalled' : 'Suspended'}
                </Badge>
              )}
              <a
                href={
                  installation.accountType === 'Organization'
                    ? `https://github.com/organizations/${installation.accountLogin}/settings/installations/${installation.installationId}`
                    : `https://github.com/settings/installations/${installation.installationId}`
                }
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Change access <ExternalLink className="size-3" />
              </a>
            </div>

            {installation.repos.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No repositories granted.</p>
            ) : (
              <ul className="divide-y">
                {installation.repos.map((repo) => (
                  <li
                    key={repo.id}
                    className={cn(
                      'flex flex-wrap items-center gap-2 px-3 py-2 text-sm',
                      !repo.isAccessible && 'opacity-50',
                    )}
                  >
                    {repo.isPrivate ? (
                      <Lock className="size-3.5 text-muted-foreground" />
                    ) : (
                      <Globe className="size-3.5 text-muted-foreground" />
                    )}
                    <a
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs hover:underline"
                    >
                      {repo.fullName}
                    </a>
                    {!repo.isAccessible && (
                      <span className="text-[11px] text-muted-foreground">no longer granted</span>
                    )}
                    <span className="ml-auto flex flex-wrap gap-1">
                      {repo.projects.map((project) => (
                        <Badge key={project.id} variant="secondary" className="text-[10px]">
                          {project.code}
                        </Badge>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

function WebhookSettings({ current }: { current: string | null }) {
  const router = useRouter()
  const [url, setUrl] = React.useState(current ?? '')
  const [isPending, startTransition] = React.useTransition()

  function save(value: string | null) {
    startTransition(async () => {
      const result = await setWebhookUrlAction({ url: value })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(value ? 'GitHub will deliver events there.' : 'Webhook switched off.')
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Webhook className="size-4 text-muted-foreground" />
          Live updates
        </h2>
        <p className="text-xs text-muted-foreground">
          GitHub pushes events to this address the moment something happens. Without one,
          TaskForge still catches up whenever someone presses <em>Sync</em> on a project, and on
          the daily schedule — just not instantly.
        </p>
      </div>

      {current ? (
        <Notice tone="ok">
          Delivering to <code className="break-all">{current}</code>
        </Notice>
      ) : (
        <Notice tone="warn">
          No public address yet. In development, run a tunnel (<code>ngrok http 3000</code>) and
          paste its https URL here.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://your-domain.example"
          className="min-w-0 flex-1 font-mono text-xs"
          aria-label="Public base URL for webhooks"
        />
        <Button onClick={() => save(url.trim())} disabled={isPending || !url.trim()}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        {current && (
          <Button variant="ghost" onClick={() => save(null)} disabled={isPending}>
            Switch off
          </Button>
        )}
      </div>
    </section>
  )
}

function ForgetApp() {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect the GitHub App?</AlertDialogTitle>
          <AlertDialogDescription>
            TaskForge forgets the app&rsquo;s credentials and stops receiving events. Links already
            recorded on tickets stay. The app itself remains on GitHub until you delete it there.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await forgetGithubAppAction()
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                router.refresh()
              })
            }
          >
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Notice({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'error'
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'ok' && 'border-emerald-500/40 bg-emerald-500/5',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
        tone === 'error' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <CircleAlert
        className={cn(
          'mt-px size-3.5 shrink-0',
          tone === 'ok' && 'text-emerald-600',
          tone === 'warn' && 'text-amber-600',
          tone === 'error' && 'text-destructive',
        )}
      />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
