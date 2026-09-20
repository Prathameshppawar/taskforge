'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectMemberRole } from '@prisma/client'

import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PROJECT_ROLE_LABELS } from '@/core/domain/rbac'
import { attachTeamAction, detachTeamAction } from '../actions'

export interface AttachedTeam {
  id: string
  name: string
  description: string | null
  role: ProjectMemberRole
  members: Array<{
    id: string
    name: string
    username: string
    avatarColor: string
    isManager: boolean
  }>
}

export interface AttachableTeam {
  id: string
  name: string
  memberCount: number
}

/**
 * Teams on a project.
 *
 * The intended way to staff a project: attach the team that owns the work, and
 * everyone in it gains access. When somebody joins or leaves that team later,
 * every project it is attached to follows automatically — which is the whole
 * point, and something a list of individually added people cannot do.
 */
export function ProjectTeamManager({
  projectId,
  teams,
  attachable,
  canManage,
}: {
  projectId: string
  teams: AttachedTeam[]
  attachable: AttachableTeam[]
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [picked, setPicked] = React.useState('')

  function run(fn: () => Promise<{ success: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await fn()
      if (!result.success) {
        toast.error(result.error ?? 'That did not work.')
        return
      }
      toast.success(done)
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Teams</h2>
          <p className="text-xs text-muted-foreground">
            Everyone in an attached team has access, and stays in step as the team changes.
          </p>
        </div>

        {canManage && attachable.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="Attach a team…" />
              </SelectTrigger>
              <SelectContent>
                {attachable.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name} ({team.memberCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8"
              disabled={!picked || isPending}
              onClick={() =>
                run(() => {
                  const promise = attachTeamAction({
                    projectId,
                    teamId: picked,
                    role: 'MEMBER',
                  })
                  setPicked('')
                  return promise
                }, 'Team attached.')
              }
            >
              Attach
            </Button>
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          No teams attached.{' '}
          {canManage && attachable.length === 0 ? (
            <>
              Create one in <Link href="/workspace/teams" className="text-primary hover:underline">Workspace → Teams</Link> first.
            </>
          ) : (
            'Attach one to give a whole group access at once.'
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {teams.map((team) => (
            <li key={team.id} className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <UsersRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{team.name}</p>
                  {team.description && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {team.description}
                    </p>
                  )}
                </div>

                {canManage ? (
                  <Select
                    value={team.role}
                    onValueChange={(role) =>
                      run(
                        () =>
                          attachTeamAction({
                            projectId,
                            teamId: team.id,
                            role: role as ProjectMemberRole,
                          }),
                        'Team role updated.',
                      )
                    }
                  >
                    <SelectTrigger className="h-7 w-28 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['MANAGER', 'MEMBER', 'VIEWER'] as const).map((role) => (
                        <SelectItem key={role} value={role}>
                          {PROJECT_ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {PROJECT_ROLE_LABELS[team.role]}
                  </span>
                )}

                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-destructive"
                    disabled={isPending}
                    title="Detach this team"
                    onClick={() =>
                      run(
                        () => detachTeamAction({ projectId, teamId: team.id }),
                        'Team detached.',
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>

              {team.members.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-muted-foreground italic">
                  This team has no members yet, so it grants nobody access.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2">
                  {team.members.map((member) => (
                    <li key={member.id} className="flex items-center gap-1.5">
                      <UserAvatar name={member.name} color={member.avatarColor} size="sm" />
                      <span className="text-xs">{member.name}</span>
                      {member.isManager && (
                        <ShieldCheck className="size-3 text-primary" aria-label="Team manager" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
