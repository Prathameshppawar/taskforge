'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ProjectStatus } from '@prisma/client'
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { DatePicker } from '@/components/shared/date-picker'
import { UserPicker, type PickableUser } from '@/components/shared/user-picker'
import { ColorPicker } from '@/components/shared/color-picker'
import { ProjectLogo } from '@/components/shared/project-logo'
import {
  archiveProjectAction,
  updateProjectAction,
  updateProjectSettingsAction,
} from '../actions'

export function ProjectSettingsForm({
  project,
  members,
  canEdit,
  canArchive,
}: {
  project: {
    id: string
    name: string
    code: string
    description: string | null
    status: ProjectStatus
    startDate: Date | null
    endDate: Date | null
    ownerId: string
    isArchived: boolean
    settings: {
      color: string
      icon: string
      autoStatusRollup: boolean
      allowSubtasks: boolean
      requireDueDate: boolean
      isPrivate: boolean
      defaultAssigneeId: string | null
      logoUrl: string | null
    } | null
  }
  members: PickableUser[]
  canEdit: boolean
  canArchive: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [confirmArchive, setConfirmArchive] = React.useState(false)

  const [details, setDetails] = React.useState({
    name: project.name,
    description: project.description ?? '',
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    ownerId: project.ownerId,
  })

  const [settings, setSettings] = React.useState({
    color: project.settings?.color ?? 'indigo',
    icon: project.settings?.icon ?? 'folder-kanban',
    autoStatusRollup: project.settings?.autoStatusRollup ?? true,
    allowSubtasks: project.settings?.allowSubtasks ?? true,
    requireDueDate: project.settings?.requireDueDate ?? false,
    isPrivate: project.settings?.isPrivate ?? false,
    defaultAssigneeId: project.settings?.defaultAssigneeId ?? null,
    logoUrl: project.settings?.logoUrl ?? '',
  })

  function saveDetails() {
    startTransition(async () => {
      const result = await updateProjectAction({ id: project.id, ...details })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Project updated.')
      router.refresh()
    })
  }

  function saveSettings(next: typeof settings) {
    setSettings(next)
    startTransition(async () => {
      const result = await updateProjectSettingsAction({ projectId: project.id, ...next })
      if (!result.success) {
        toast.error(result.error)
        setSettings(settings)
        return
      }
      router.refresh()
    })
  }

  function toggleArchive() {
    startTransition(async () => {
      const result = await archiveProjectAction({
        projectId: project.id,
        isArchived: !project.isArchived,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(project.isArchived ? 'Project restored.' : 'Project archived.')
      setConfirmArchive(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      {/* Details */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Details</h2>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={details.name}
              onChange={(event) => setDetails({ ...details, name: event.target.value })}
              disabled={!canEdit || isPending}
            />
          </div>

          <div className="space-y-1.5 sm:w-32">
            <Label htmlFor="project-code">Code</Label>
            <Input
              id="project-code"
              value={project.code}
              disabled
              className="font-mono"
              title="The project code cannot be changed — existing ticket keys depend on it."
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            value={details.description}
            onChange={(event) => setDetails({ ...details, description: event.target.value })}
            rows={3}
            disabled={!canEdit || isPending}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="project-status">Status</Label>
            <Select
              value={details.status}
              onValueChange={(value) =>
                setDetails({ ...details, status: value as ProjectStatus })
              }
              disabled={!canEdit || isPending}
            >
              <SelectTrigger id="project-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PLANNING">Planning</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ON_HOLD">On hold</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Start date</Label>
            <DatePicker
              value={details.startDate}
              onChange={(startDate) => setDetails({ ...details, startDate })}
              disabled={!canEdit || isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Target end date</Label>
            <DatePicker
              value={details.endDate}
              onChange={(endDate) => setDetails({ ...details, endDate })}
              disabled={!canEdit || isPending}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Owner</Label>
          <UserPicker
            users={members}
            value={details.ownerId}
            onChange={(ownerId) => ownerId && setDetails({ ...details, ownerId })}
            allowUnassigned={false}
            disabled={!canEdit || isPending}
          />
          <p className="text-[11px] text-muted-foreground">
            A new owner is automatically added as a project manager.
          </p>
        </div>

        {canEdit && (
          <Button onClick={saveDetails} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Save details
          </Button>
        )}
      </section>

      {/* Behaviour */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Behaviour</h2>

        <div className="space-y-2">
          <SettingSwitch
            id="rollup"
            label="Automatic status rollup"
            description="Move a parent ticket's status automatically as its children progress."
            checked={settings.autoStatusRollup}
            disabled={!canEdit || isPending}
            onChange={(value) => saveSettings({ ...settings, autoStatusRollup: value })}
          />
          <SettingSwitch
            id="subtasks"
            label="Allow child tickets"
            description="Let tickets be broken down into implementation tasks."
            checked={settings.allowSubtasks}
            disabled={!canEdit || isPending}
            onChange={(value) => saveSettings({ ...settings, allowSubtasks: value })}
          />
          <SettingSwitch
            id="due-date"
            label="Require a due date"
            description="Reject new tickets that do not have one."
            checked={settings.requireDueDate}
            disabled={!canEdit || isPending}
            onChange={(value) => saveSettings({ ...settings, requireDueDate: value })}
          />
          <SettingSwitch
            id="private"
            label="Private project"
            description="Only members can see it. Administrators always can."
            checked={settings.isPrivate}
            disabled={!canEdit || isPending}
            onChange={(value) => saveSettings({ ...settings, isPrivate: value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Default assignee</Label>
          <UserPicker
            users={members}
            value={settings.defaultAssigneeId}
            onChange={(defaultAssigneeId) => saveSettings({ ...settings, defaultAssigneeId })}
            disabled={!canEdit || isPending}
            placeholder="No default"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="logo-url">Logo URL</Label>
          <div className="flex items-center gap-3">
            <ProjectLogo
              name={project.name}
              color={settings.color}
              logoUrl={settings.logoUrl || null}
              size="lg"
            />
            <Input
              id="logo-url"
              value={settings.logoUrl}
              onChange={(event) => setSettings({ ...settings, logoUrl: event.target.value })}
              onBlur={() => saveSettings(settings)}
              placeholder="https://example.com/logo.png"
              disabled={!canEdit || isPending}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Paste a link to an image. TaskForge stores the link, never the file.
            Leave it empty to use the colour below instead.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Project colour</Label>
          <p className="text-[11px] text-muted-foreground">
            Used wherever no logo is set, and if the logo fails to load.
          </p>
          <ColorPicker
            value={settings.color}
            onChange={(color) => saveSettings({ ...settings, color })}
          />
        </div>
      </section>

      {/* Danger zone */}
      {canArchive && (
        <section className="space-y-3 rounded-xl border border-destructive/30 p-4">
          <div>
            <h2 className="text-sm font-semibold">
              {project.isArchived ? 'Restore project' : 'Archive project'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {project.isArchived
                ? 'Restoring makes the project active again and returns it to the project list.'
                : 'Archiving hides the project from the default list and blocks new tickets. Nothing is deleted, and it can be restored at any time.'}
            </p>
          </div>

          <Button
            variant={project.isArchived ? 'outline' : 'destructive'}
            size="sm"
            onClick={() => (project.isArchived ? toggleArchive() : setConfirmArchive(true))}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : project.isArchived ? (
              <ArchiveRestore className="size-4" />
            ) : (
              <Archive className="size-4" />
            )}
            {project.isArchived ? 'Restore project' : 'Archive project'}
          </Button>
        </section>
      )}

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and all of its tickets are preserved — it is hidden from the default
              project list and no new tickets can be created until it is restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                toggleArchive()
              }}
              disabled={isPending}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SettingSwitch({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
