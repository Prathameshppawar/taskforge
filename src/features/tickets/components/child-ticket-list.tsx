'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GitBranch, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge, PriorityBadge } from '@/components/shared/badges'
import { UserAvatar } from '@/components/shared/user-avatar'
import { addChildTicketsAction } from '../actions'

interface ChildTicket {
  id: string
  key: string
  title: string
  dueDate: Date | null
  status: { id: string; name: string; color: string; category: string }
  priority: { id: string; name: string; color: string; level: number }
  type: { id: string; name: string; color: string }
  assignee: { id: string; name: string; avatarColor: string } | null
}

/**
 * Child tickets of a parent, plus a quick "break this down" dialog that accepts
 * one title per line.
 */
export function ChildTicketList({
  parentId,
  parentKey,
  children,
  canEdit,
  isChild,
}: {
  parentId: string
  parentKey: string
  children: ChildTicket[]
  canEdit: boolean
  isChild: boolean
}) {
  const [open, setOpen] = React.useState(false)

  // A child ticket cannot itself have children — the hierarchy stops at two
  // levels — so the section is hidden entirely rather than shown empty.
  if (isChild && children.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="size-4" />
          Child tickets
          {children.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
              {children.length}
            </span>
          )}
        </h2>
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" /> Break down
          </Button>
        )}
      </div>

      {children.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Split this feature into implementation tasks.'
            : 'No child tickets.'}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {children.map((child) => (
            <li
              key={child.id}
              className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-accent/40"
            >
              <Link
                href={`/tickets/${child.key}`}
                className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                {child.key}
              </Link>
              <Link
                href={`/tickets/${child.key}`}
                className="min-w-0 flex-1 truncate text-sm hover:underline"
              >
                {child.title}
              </Link>
              {child.dueDate && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {child.dueDate.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
              <StatusBadge name={child.status.name} color={child.status.color} />
              <PriorityBadge
                name={child.priority.name}
                color={child.priority.color}
                level={child.priority.level}
                showLabel={false}
              />
              {child.assignee ? (
                <UserAvatar
                  name={child.assignee.name}
                  color={child.assignee.avatarColor}
                  size="xs"
                />
              ) : (
                <span className={cn('size-5 rounded-full border border-dashed')} />
              )}
            </li>
          ))}
        </ul>
      )}

      <BreakDownDialog
        parentId={parentId}
        parentKey={parentKey}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  )
}

function BreakDownDialog({
  parentId,
  parentKey,
  open,
  onOpenChange,
}: {
  parentId: string
  parentKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [text, setText] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  const titles = text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((line) => line.length >= 3)

  function submit() {
    startTransition(async () => {
      const result = await addChildTicketsAction({ parentId, titles })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Created ${result.data.created} child tickets.`)
      setText('')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Break down {parentKey}</DialogTitle>
          <DialogDescription>
            One title per line. Each becomes a child ticket inheriting this
            ticket&apos;s type and priority.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          autoFocus
          disabled={isPending}
          placeholder={'Login API\nLogin UI\nPassword Reset API\nPassword Reset UI'}
          className="font-mono text-sm"
        />

        <p className="text-xs text-muted-foreground">
          {titles.length} {titles.length === 1 ? 'ticket' : 'tickets'} will be created.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || titles.length === 0}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Create {titles.length > 0 ? titles.length : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
