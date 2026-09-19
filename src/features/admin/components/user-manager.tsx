'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  UserPlus,
  UserX,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  adminResetPasswordAction,
  createUserAction,
  setUserActiveAction,
  updateUserAction,
} from '@/features/auth/actions'

export interface ManagedUser {
  id: string
  username: string
  email: string
  name: string
  jobTitle: string | null
  avatarColor: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: Date | null
  createdAt: Date
  role: { key: string; name: string; level: number }
  projectCount: number
  assignedCount: number
}

/** A role the signed-in administrator is permitted to hand out. */
export interface AssignableRole {
  key: string
  name: string
  description: string | null
  level: number
}

export function UserManager({
  users,
  currentUserId,
  assignableRoles,
}: {
  users: ManagedUser[]
  currentUserId: string
  /**
   * Only roles ranked below the signed-in user. Filtered on the server as well
   * — this list shapes the form, it does not enforce anything.
   */
  assignableRoles: AssignableRole[]
}) {
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<ManagedUser | null>(null)
  const [resetting, setResetting] = React.useState<ManagedUser | null>(null)

  const activeAdmins = users.filter((user) => user.role.key === 'ADMIN' && user.isActive).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" />
          New user
        </Button>
        <span className="text-xs text-muted-foreground">
          {users.filter((u) => u.isActive).length} active · {activeAdmins}{' '}
          {activeAdmins === 1 ? 'admin' : 'admins'}
        </span>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9">User</TableHead>
              <TableHead className="h-9">Role</TableHead>
              <TableHead className="h-9">Projects</TableHead>
              <TableHead className="h-9">Assigned</TableHead>
              <TableHead className="h-9">Last sign-in</TableHead>
              <TableHead className="h-9 w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className={cn(!user.isActive && 'opacity-55')}>
                <TableCell className="py-2">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={user.name} color={user.avatarColor} size="md" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{user.name}</span>
                        {user.id === currentUserId && (
                          <Badge variant="secondary" className="text-[10px]">
                            You
                          </Badge>
                        )}
                        {!user.isActive && (
                          <Badge variant="outline" className="text-[10px]">
                            Deactivated
                          </Badge>
                        )}
                        {user.mustChangePassword && user.isActive && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <KeyRound className="size-2.5" />
                            Must reset
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        @{user.username} · {user.email}
                      </p>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="py-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    {user.role.level === 0 && <ShieldCheck className="size-3 text-primary" />}
                    {user.role.name}
                  </span>
                </TableCell>

                <TableCell className="py-2 text-xs tabular-nums">
                  {user.projectCount}
                </TableCell>
                <TableCell className="py-2 text-xs tabular-nums">
                  {user.assignedCount}
                </TableCell>
                <TableCell className="py-2 text-xs text-muted-foreground">
                  {user.lastLoginAt ? user.lastLoginAt.toLocaleDateString() : 'Never'}
                </TableCell>

                <TableCell className="py-2">
                  <UserActions
                    user={user}
                    isSelf={user.id === currentUserId}
                    onEdit={() => setEditing(user)}
                    onReset={() => setResetting(user)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <UserDialog
        user={editing}
        assignableRoles={assignableRoles}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />

      <ResetPasswordDialog
        user={resetting}
        onOpenChange={(open) => !open && setResetting(null)}
      />
    </div>
  )
}

function UserActions({
  user,
  isSelf,
  onEdit,
  onReset,
}: {
  user: ManagedUser
  isSelf: boolean
  onEdit: () => void
  onReset: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function toggleActive() {
    startTransition(async () => {
      const result = await setUserActiveAction({
        userId: user.id,
        isActive: !user.isActive,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        user.isActive
          ? `${user.name} deactivated — their sessions have been ended.`
          : `${user.name} reactivated.`,
      )
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" disabled={isPending}>
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
          <span className="sr-only">Actions for {user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" /> Edit details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReset}>
          <KeyRound className="size-4" /> Reset password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant={user.isActive ? 'destructive' : 'default'}
          onSelect={toggleActive}
          disabled={isSelf && user.isActive}
        >
          <UserX className="size-4" />
          {user.isActive ? 'Deactivate' : 'Reactivate'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserDialog({
  user,
  assignableRoles,
  open,
  onOpenChange,
}: {
  user: ManagedUser | null
  assignableRoles: AssignableRole[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const [form, setForm] = React.useState({
    username: '',
    email: '',
    name: '',
    jobTitle: '',
    password: '',
    roleKey: 'USER',
    mustChangePassword: true,
  })

  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setForm({
      username: user?.username ?? '',
      email: user?.email ?? '',
      name: user?.name ?? '',
      jobTitle: user?.jobTitle ?? '',
      password: '',
      roleKey: user?.role.key ?? 'USER',
      mustChangePassword: true,
    })
  }, [open, user])

  function submit() {
    setErrors({})

    startTransition(async () => {
      const result = user
        ? await updateUserAction({
            id: user.id,
            email: form.email,
            name: form.name,
            jobTitle: form.jobTitle,
            roleKey: form.roleKey,
          })
        : await createUserAction({
            username: form.username,
            email: form.email,
            name: form.name,
            jobTitle: form.jobTitle,
            password: form.password,
            roleKey: form.roleKey,
            mustChangePassword: form.mustChangePassword,
          })

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

      toast.success(user ? 'User updated.' : 'User created.')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit user' : 'New user'}</DialogTitle>
          <DialogDescription>
            {user
              ? 'The username cannot be changed once the account exists.'
              : 'Accounts are provisioned here — there is no self sign-up.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Full name" error={errors.name}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoFocus
            />
          </Field>

          {!user && (
            <Field label="Username" error={errors.username}>
              <Input
                value={form.username}
                onChange={(event) =>
                  setForm({ ...form, username: event.target.value.toLowerCase() })
                }
                placeholder="arjun.mehta"
              />
            </Field>
          )}

          <Field label="Email" error={errors.email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>

          <Field label="Job title" error={errors.jobTitle}>
            <Input
              value={form.jobTitle}
              onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
              placeholder="Backend Engineer"
            />
          </Field>

          <Field label="Role" error={errors.roleKey}>
            <Select
              value={form.roleKey}
              onValueChange={(value) => setForm({ ...form, roleKey: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((role) => (
                  <SelectItem key={role.key} value={role.key}>
                    {role.name}
                    {role.description ? ` — ${role.description}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {!user && (
            <>
              <Field
                label="Temporary password"
                error={errors.password}
                hint="At least 8 characters, with upper and lower case and a number."
              >
                <Input
                  type="text"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder="Welcome!2024"
                />
              </Field>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="must-change">Require a password change</Label>
                  <p className="text-xs text-muted-foreground">
                    They must choose their own password at first sign-in.
                  </p>
                </div>
                <Switch
                  id="must-change"
                  checked={form.mustChangePassword}
                  onCheckedChange={(value) => setForm({ ...form, mustChangePassword: value })}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {user ? 'Save' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: ManagedUser | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [password, setPassword] = React.useState('')
  const [mustChange, setMustChange] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (user) {
      setPassword('')
      setError(null)
      setMustChange(true)
    }
  }, [user])

  function submit() {
    if (!user) return
    setError(null)

    startTransition(async () => {
      const result = await adminResetPasswordAction({
        userId: user.id,
        password,
        mustChangePassword: mustChange,
      })

      if (!result.success) {
        setError(result.fieldErrors?.password?.[0] ?? result.error)
        return
      }

      toast.success(`Password reset. ${user.name}'s existing sessions have been ended.`)
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {user?.name}</DialogTitle>
          <DialogDescription>
            Set a temporary password and pass it to them securely. Every session they
            currently have will be signed out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="New password" error={error ?? undefined}>
            <Input
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Temp!2024pass"
              autoFocus
            />
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="reset-must-change">Require a password change</Label>
              <p className="text-xs text-muted-foreground">
                They choose their own password at next sign-in.
              </p>
            </div>
            <Switch
              id="reset-must-change"
              checked={mustChange}
              onCheckedChange={setMustChange}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || password.length < 8}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
