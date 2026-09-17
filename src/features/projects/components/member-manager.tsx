'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ProjectMemberRole } from '@prisma/client'
import { Crown, Loader2, UserMinus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Label } from '@/components/ui/label'
import { UserAvatar } from '@/components/shared/user-avatar'
import { MultiUserPicker, type PickableUser } from '@/components/shared/user-picker'
import { PROJECT_ROLE_LABELS } from '@/core/domain/rbac'
import {
  addMembersAction,
  removeMemberAction,
  updateMemberRoleAction,
} from '../actions'

export interface ProjectMemberRow {
  userId: string
  name: string
  username: string
  avatarColor: string
  jobTitle: string | null
  isActive: boolean
  role: ProjectMemberRole
  joinedAt: Date
  isOwner: boolean
}

export function MemberManager({
  projectId,
  members,
  assignableUsers,
  canManage,
}: {
  projectId: string
  members: ProjectMemberRow[]
  assignableUsers: PickableUser[]
  canManage: boolean
}) {
  const [addOpen, setAddOpen] = React.useState(false)

  const memberIds = new Set(members.map((member) => member.userId))
  const candidates = assignableUsers.filter((user) => !memberIds.has(user.id))

  return (
    <div className="space-y-4">
      {canManage && candidates.length > 0 && (
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="size-4" />
          Add members
        </Button>
      )}

      <ul className="divide-y rounded-xl border">
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            projectId={projectId}
            member={member}
            canManage={canManage}
          />
        ))}
      </ul>

      <AddMembersDialog
        projectId={projectId}
        candidates={candidates}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  )
}

function MemberRow({
  projectId,
  member,
  canManage,
}: {
  projectId: string
  member: ProjectMemberRow
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function changeRole(role: ProjectMemberRole) {
    startTransition(async () => {
      const result = await updateMemberRoleAction({ projectId, userId: member.userId, role })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await removeMemberAction({ projectId, userId: member.userId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${member.name} removed from the project.`)
      router.refresh()
    })
  }

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <UserAvatar name={member.name} color={member.avatarColor} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{member.name}</span>
          {member.isOwner && (
            <Badge variant="secondary" className="gap-1">
              <Crown className="size-3" /> Owner
            </Badge>
          )}
          {!member.isActive && <Badge variant="outline">Deactivated</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          @{member.username}
          {member.jobTitle && ` · ${member.jobTitle}`}
        </p>
      </div>

      {canManage && !member.isOwner ? (
        <Select
          value={member.role}
          onValueChange={(value) => changeRole(value as ProjectMemberRole)}
          disabled={isPending}
        >
          <SelectTrigger className="w-32" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MANAGER">Manager</SelectItem>
            <SelectItem value="MEMBER">Member</SelectItem>
            <SelectItem value="VIEWER">Viewer</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground">
          {PROJECT_ROLE_LABELS[member.role]}
        </span>
      )}

      {canManage && !member.isOwner && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 hover:text-destructive"
          onClick={remove}
          disabled={isPending}
          aria-label={`Remove ${member.name}`}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserMinus className="size-4" />
          )}
        </Button>
      )}
    </li>
  )
}

function AddMembersDialog({
  projectId,
  candidates,
  open,
  onOpenChange,
}: {
  projectId: string
  candidates: PickableUser[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<string[]>([])
  const [role, setRole] = React.useState<ProjectMemberRole>('MEMBER')
  const [isPending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const result = await addMembersAction({ projectId, userIds: selected, role })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Added ${result.data} ${result.data === 1 ? 'person' : 'people'}.`)
      setSelected([])
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>
            Members can see this project and work on its tickets. Viewers get read-only access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>People</Label>
            <MultiUserPicker users={candidates} value={selected} onChange={setSelected} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="member-role">Project role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as ProjectMemberRole)}>
              <SelectTrigger id="member-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANAGER">Manager — full control of the project</SelectItem>
                <SelectItem value="MEMBER">Member — create and edit tickets</SelectItem>
                <SelectItem value="VIEWER">Viewer — read only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || selected.length === 0}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Add {selected.length > 0 ? selected.length : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
