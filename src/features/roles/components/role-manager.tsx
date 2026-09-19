'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Plus, ShieldCheck, Trash2, Pencil, Users } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PERMISSION_GROUPS, type Permission } from '@/core/domain/rbac'
import { createRoleAction, updateRoleAction, deleteRoleAction } from '../actions'

export interface ManagedRole {
  id: string
  key: string
  name: string
  description: string | null
  level: number
  isSystem: boolean
  permissions: string[]
  userCount: number
}

export function RoleManager({
  roles,
  actorLevel,
  actorPermissions,
}: {
  roles: ManagedRole[]
  /** Roles at or above this rank are shown but not editable. */
  actorLevel: number
  /** A role cannot be given a permission its author does not hold. */
  actorPermissions: Permission[]
}) {
  const [editing, setEditing] = React.useState<ManagedRole | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ManagedRole | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Built-in roles are fixed. Custom roles you create can hold any permission you
          hold yourself, at any rank below your own.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New role
        </Button>
      </div>

      <ul className="space-y-2">
        {roles.map((role) => {
          const editable = !role.isSystem && role.level > actorLevel

          return (
            <li
              key={role.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {role.level === 0 ? (
                    <ShieldCheck className="size-4 shrink-0 text-primary" />
                  ) : null}
                  <span className="truncate text-sm font-medium">{role.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {role.key}
                  </span>
                  {role.isSystem && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <Lock className="size-2.5" />
                      built-in
                    </span>
                  )}
                </div>
                {role.description && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {role.description}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                <span title="Lower ranks higher">rank {role.level}</span>
                <span>{role.permissions.length} permissions</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" />
                  {role.userCount}
                </span>
              </div>

              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  disabled={!editable}
                  title={
                    role.isSystem
                      ? 'Built-in roles cannot be changed'
                      : role.level <= actorLevel
                        ? 'This role ranks at or above your own'
                        : undefined
                  }
                  onClick={() => setEditing(role)}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-destructive"
                  disabled={!editable}
                  onClick={() => setDeleting(role)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <RoleDialog
        role={editing}
        open={creating || editing !== null}
        actorLevel={actorLevel}
        actorPermissions={actorPermissions}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />

      <DeleteRoleDialog role={deleting} onOpenChange={() => setDeleting(null)} />
    </div>
  )
}

function RoleDialog({
  role,
  open,
  actorLevel,
  actorPermissions,
  onOpenChange,
}: {
  role: ManagedRole | null
  open: boolean
  actorLevel: number
  actorPermissions: Permission[]
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [form, setForm] = React.useState({
    key: '',
    name: '',
    description: '',
    level: String(actorLevel + 10),
    permissions: [] as string[],
  })

  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setForm({
      key: role?.key ?? '',
      name: role?.name ?? '',
      description: role?.description ?? '',
      level: String(role?.level ?? actorLevel + 10),
      permissions: role?.permissions ?? [],
    })
  }, [open, role, actorLevel])

  const held = React.useMemo(() => new Set<string>(actorPermissions), [actorPermissions])

  function toggle(permission: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      permissions: checked
        ? [...current.permissions, permission]
        : current.permissions.filter((value) => value !== permission),
    }))
  }

  function submit() {
    setErrors({})
    startTransition(async () => {
      const payload = {
        name: form.name,
        description: form.description.trim() === '' ? null : form.description,
        level: Number(form.level),
        permissions: form.permissions,
      }

      const result = role
        ? await updateRoleAction({ ...payload, id: role.id })
        : await createRoleAction({ ...payload, key: form.key.toUpperCase() })

      if (!result.success) {
        if (result.fieldErrors) {
          setErrors(
            Object.fromEntries(
              Object.entries(result.fieldErrors).map(([key, value]) => [key, value[0]]),
            ),
          )
        }
        toast.error(result.error)
        return
      }

      toast.success(role ? 'Role updated.' : 'Role created.')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{role ? `Edit ${role.name}` : 'New role'}</DialogTitle>
          <DialogDescription>
            A role is a named set of permissions and a rank. People can only be given
            roles that rank below their grantor.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60dvh]">
          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Labelled label="Name" error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Team Lead"
                />
              </Labelled>

              <Labelled
                label="Key"
                error={errors.key}
                hint={role ? 'Fixed once created' : 'Capitals and underscores'}
              >
                <Input
                  value={form.key}
                  disabled={role !== null}
                  onChange={(event) =>
                    setForm({ ...form, key: event.target.value.toUpperCase() })
                  }
                  placeholder="TEAM_LEAD"
                  className="font-mono"
                />
              </Labelled>
            </div>

            <Labelled label="Description" error={errors.description}>
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Runs a delivery team and its people"
              />
            </Labelled>

            <Labelled
              label="Rank"
              error={errors.level}
              hint={`Lower is more senior. Must be above ${actorLevel} — your own rank.`}
            >
              <Input
                type="number"
                min={actorLevel + 1}
                value={form.level}
                onChange={(event) => setForm({ ...form, level: event.target.value })}
                className="w-32"
              />
            </Labelled>

            <div className="space-y-3 pt-1">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">Permissions</p>
                <p className="text-xs text-muted-foreground">
                  {form.permissions.length} selected
                </p>
              </div>

              {PERMISSION_GROUPS.map((group) => (
                <div key={group.label} className="rounded-lg border">
                  <div className="border-b bg-muted/40 px-3 py-1.5">
                    <p className="text-xs font-medium">{group.label}</p>
                    <p className="text-[11px] text-muted-foreground">{group.description}</p>
                  </div>
                  <div className="divide-y">
                    {group.permissions.map((permission) => {
                      const grantable = held.has(permission.key)
                      const checked = form.permissions.includes(permission.key)

                      return (
                        <label
                          key={permission.key}
                          className={cn(
                            'flex cursor-pointer items-start gap-2.5 px-3 py-2',
                            !grantable && 'cursor-not-allowed opacity-50',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={!grantable}
                            onCheckedChange={(value) => toggle(permission.key, value === true)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs">{permission.label}</span>
                            {permission.note && (
                              <span className="block text-[11px] text-muted-foreground">
                                {permission.note}
                              </span>
                            )}
                            {!grantable && (
                              <span className="block text-[11px] text-muted-foreground italic">
                                You do not hold this permission, so you cannot grant it.
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {permission.key}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Saving…' : role ? 'Save changes' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteRoleDialog({
  role,
  onOpenChange,
}: {
  role: ManagedRole | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  return (
    <AlertDialog open={role !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {role?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {role && role.userCount > 0
              ? `${role.userCount} ${role.userCount === 1 ? 'person holds' : 'people hold'} this role. Move them to another role first.`
              : 'This cannot be undone. Nobody currently holds this role.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || (role?.userCount ?? 0) > 0}
            onClick={(event) => {
              event.preventDefault()
              if (!role) return
              startTransition(async () => {
                const result = await deleteRoleAction(role.id)
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                toast.success('Role deleted.')
                onOpenChange(false)
                router.refresh()
              })
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Labelled({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
