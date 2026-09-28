'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FolderGit2, Globe, Loader2, Lock, Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  linkRepoAction,
  setAiWorkflowsAction,
  setGithubAutomationAction,
  setRepoRoleAction,
  syncProjectReposAction,
  unlinkRepoAction,
} from '../actions'
import type { ProjectRepos } from '../queries'

/**
 * A project's repositories.
 *
 * Several per project is the normal case, not the edge case — an app, its API
 * and a CMS are three repositories and one piece of work — so each link can
 * carry a short role to tell them apart on a ticket.
 */
export function ProjectRepositories({
  projectId,
  projectCode,
  repos,
  canEdit,
  canManageIntegrations,
}: {
  projectId: string
  projectCode: string
  repos: ProjectRepos
  canEdit: boolean
  canManageIntegrations: boolean
}) {
  const router = useRouter()
  const [repoId, setRepoId] = React.useState('')
  const [role, setRole] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  function run<T>(
    work: () => Promise<{ success: true; data: T } | { success: false; error: string }>,
    done?: (data: T) => void,
  ) {
    startTransition(async () => {
      const result = await work()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      done?.(result.data)
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Repositories</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Branches, pull requests and commits that mention a ticket key —{' '}
            <code className="rounded bg-muted px-1">{projectCode}-12</code> — are linked to that
            ticket automatically.
          </p>
        </div>
        {repos.linked.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => syncProjectReposAction(projectId),
                (data) =>
                  toast.success(
                    data.tickets > 0
                      ? `Updated ${data.tickets} ${data.tickets === 1 ? 'ticket' : 'tickets'}.`
                      : 'Already up to date.',
                  ),
              )
            }
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sync
          </Button>
        )}
      </div>

      {!repos.hasGithub ? (
        <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
          GitHub is not connected yet.{' '}
          {canManageIntegrations ? (
            <Link href="/workspace/integrations" className="font-medium text-primary hover:underline">
              Connect it
            </Link>
          ) : (
            'Ask a workspace administrator to connect it.'
          )}
        </p>
      ) : (
        <>
          {repos.linked.length > 0 && (
            <ul className="divide-y rounded-xl border">
              {repos.linked.map((repo) => (
                <li
                  key={repo.id}
                  className={cn('flex flex-wrap items-center gap-2 p-2.5', !repo.isAccessible && 'opacity-60')}
                >
                  {repo.isPrivate ? (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <a
                    href={repo.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate font-mono text-xs hover:underline"
                  >
                    {repo.fullName}
                  </a>
                  {!repo.isAccessible && (
                    <span className="text-[11px] text-destructive">app lost access</span>
                  )}
                  <RoleInput
                    value={repo.role}
                    disabled={!canEdit || isPending}
                    onSave={(value) =>
                      run(() => setRepoRoleAction({ projectId, repoId: repo.id, role: value }))
                    }
                  />
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`Unlink ${repo.fullName}`}
                      disabled={isPending}
                      onClick={() => run(() => unlinkRepoAction({ projectId, repoId: repo.id }))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/20 p-3">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="link-repo" className="text-xs">
                  Link a repository
                </Label>
                <Select value={repoId} onValueChange={setRepoId}>
                  <SelectTrigger id="link-repo" className="h-8 text-xs">
                    <SelectValue
                      placeholder={
                        repos.available.length ? 'Choose a repository' : 'Every repository is linked'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.available.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id} className="font-mono text-xs">
                        {repo.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor="link-role" className="text-xs">
                  Role <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="link-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder="Web app"
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={isPending || !repoId}
                onClick={() =>
                  run(
                    () => linkRepoAction({ projectId, repoId, role: role.trim() || null }),
                    (data) => {
                      setRepoId('')
                      setRole('')
                      toast.success(
                        data.tickets > 0
                          ? `Linked, and found work on ${data.tickets} ${data.tickets === 1 ? 'ticket' : 'tickets'}.`
                          : 'Linked.',
                      )
                    },
                  )
                }
              >
                <Plus className="size-4" />
                Link
              </Button>
            </div>
          )}

          {repos.linked.length === 0 && !canEdit && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <FolderGit2 className="size-4" /> No repositories linked.
            </p>
          )}

          <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="github-automation">Move tickets from GitHub</Label>
              <p className="text-xs text-muted-foreground">
                A new branch moves a ticket to In Progress, an open pull request to Review, a merge
                to Done. Only ever forward — never undoing a move somebody made by hand.
              </p>
            </div>
            <Switch
              id="github-automation"
              checked={repos.automation}
              disabled={!canEdit || isPending}
              onCheckedChange={(enabled) =>
                run(() => setGithubAutomationAction({ projectId, enabled }))
              }
            />
          </div>

          <div className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-workflows">Let Fix with AI write CI workflows</Label>
                <p className="text-xs text-muted-foreground">
                  For tickets like &ldquo;set up CI&rdquo; or &ldquo;deploy on merge&rdquo;. Every workflow is
                  checked before it is committed — no secrets beyond <code>GITHUB_TOKEN</code>, no{' '}
                  <code>pull_request_target</code>, third-party actions pinned — and opens as a draft pull
                  request.
                </p>
              </div>
              <Switch
                id="ai-workflows"
                checked={repos.aiWorkflows}
                disabled={!canEdit || isPending}
                onCheckedChange={(enabled) => run(() => setAiWorkflowsAction({ projectId, enabled }))}
              />
            </div>
            {repos.aiWorkflows && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px]">
                GitHub also requires the app to hold the <strong>Workflows: Read and write</strong> permission.{' '}
                {repos.appPermissionsUrl ? (
                  <a href={repos.appPermissionsUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                    Add it on GitHub
                  </a>
                ) : (
                  'Add it in the app’s settings on GitHub'
                )}
                , then accept the change on the installation.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** Saves on blur or Enter, so renaming a role needs no extra button. */
function RoleInput({
  value,
  disabled,
  onSave,
}: {
  value: string | null
  disabled: boolean
  onSave: (value: string | null) => void
}) {
  const [draft, setDraft] = React.useState(value ?? '')
  React.useEffect(() => setDraft(value ?? ''), [value])

  const commit = () => {
    const next = draft.trim() || null
    if (next !== (value ?? null)) onSave(next)
  }

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && (event.currentTarget.blur())}
      disabled={disabled}
      placeholder="Role"
      aria-label="Repository role"
      className="ml-auto h-7 w-32 text-xs"
    />
  )
}
