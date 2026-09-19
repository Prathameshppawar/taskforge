'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ShieldCheck, Trash2, UserMinus, UserPlus, Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createTeamAction,
  updateTeamAction,
  deleteTeamAction,
  setTeamMemberAction,
  removeTeamMemberAction,
} from '../actions'

export interface TeamPerson {
  id: string
  name: string
  username: string
  avatarColor: string
  roleName: string
  isManager: boolean
}

export interface ManagedTeam {
  id: string
  name: string
  description: string | null
  members: TeamPerson[]
  /** False for a delegated manager, who may change members but not the team itself. */
  canEditTeam: boolean
  canManageMembers: boolean
}

export interface AssignablePerson {
  id: string
  name: string
  username: string
  avatarColor: string
}

export function TeamManager({
  teams,
  assignablePeople,
  canCreateTeams,
}: {
  teams: ManagedTeam[]
  /** People ranked below the viewer — the only ones they may add. */
  assignablePeople: AssignablePerson[]
  canCreateTeams: boolean
}) {
  const [editing, setEditing] = React.useState<ManagedTeam | null>(null)
  const [creating, setCreating] = React.useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          A team manager can administer the people in their own team, and nobody else.
        </p>
        {canCreateTeams && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New team
          </Button>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No teams yet. Create one to delegate people management.
        </p>
      ) : (
        <ul className="space-y-3">
          {teams.map((team) => (
            <li key={team.id} className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{team.name}</p>
                  {team.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      {team.description}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {team.members.length} {team.members.length === 1 ? 'person' : 'people'}
                </span>
                {team.canEditTeam && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => setEditing(team)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <DeleteTeam team={team} />
                  </div>
                )}
              </div>

              <TeamMembers team={team} assignablePeople={assignablePeople} />
            </li>
          ))}
        </ul>
      )}

      <TeamDialog
        team={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
    </div>
  )
}

function TeamMembers({
  team,
  assignablePeople,
}: {
  team: ManagedTeam
  assignablePeople: AssignablePerson[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [adding, setAdding] = React.useState('')

  const inTeam = new Set(team.members.map((member) => member.id))
  const available = assignablePeople.filter((person) => !inTeam.has(person.id))

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
    <div>
      {team.members.length > 0 && (
        <ul className="divide-y">
          {team.members.map((member) => (
            <li key={member.id} className="flex items-center gap-2.5 px-3 py-2">
              <UserAvatar name={member.name} color={member.avatarColor} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{member.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  @{member.username} · {member.roleName}
                </p>
              </div>

              {member.isManager && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  <ShieldCheck className="size-2.5" />
                  manager
                </span>
              )}

              {team.canManageMembers && (
                <div className="flex shrink-0 gap-0.5">
                  {team.canEditTeam && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px]"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () =>
                            setTeamMemberAction({
                              teamId: team.id,
                              userId: member.id,
                              isManager: !member.isManager,
                            }),
                          member.isManager ? 'No longer a manager.' : 'Now a manager.',
                        )
                      }
                    >
                      {member.isManager ? 'Demote' : 'Make manager'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-destructive"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () =>
                          removeTeamMemberAction({ teamId: team.id, userId: member.id }),
                        'Removed from the team.',
                      )
                    }
                  >
                    <UserMinus className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {team.canManageMembers && (
        <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2">
          <Select value={adding} onValueChange={setAdding}>
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue placeholder="Add someone…" />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Nobody left to add.
                </div>
              ) : (
                available.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name} (@{person.username})
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-7"
            disabled={!adding || isPending}
            onClick={() =>
              run(() => {
                const promise = setTeamMemberAction({ teamId: team.id, userId: adding })
                setAdding('')
                return promise
              }, 'Added to the team.')
            }
          >
            <UserPlus className="size-3.5" />
            Add
          </Button>
        </div>
      )}
    </div>
  )
}

function DeleteTeam({ team }: { team: ManagedTeam }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-destructive"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteTeamAction(team.id)
          if (!result.success) {
            toast.error(result.error)
            return
          }
          toast.success('Team deleted.')
          router.refresh()
        })
      }
    >
      <Trash2 className="size-3.5" />
    </Button>
  )
}

function TeamDialog({
  team,
  open,
  onOpenChange,
}: {
  team: ManagedTeam | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [form, setForm] = React.useState({ name: '', description: '' })

  React.useEffect(() => {
    if (!open) return
    setForm({ name: team?.name ?? '', description: team?.description ?? '' })
  }, [open, team])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{team ? `Edit ${team.name}` : 'New team'}</DialogTitle>
          <DialogDescription>
            Teams scope delegated administration — a manager acts on their own team only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Tablet Platform"
          />
          <Input
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="What this team is responsible for"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={isPending || form.name.trim().length < 2}
            onClick={() =>
              startTransition(async () => {
                const payload = {
                  name: form.name,
                  description: form.description.trim() === '' ? null : form.description,
                }
                const result = team
                  ? await updateTeamAction({ ...payload, id: team.id })
                  : await createTeamAction(payload)

                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                toast.success(team ? 'Team updated.' : 'Team created.')
                onOpenChange(false)
                router.refresh()
              })
            }
          >
            {isPending ? 'Saving…' : team ? 'Save' : 'Create team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
