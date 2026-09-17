'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, MessageSquare, Pencil, Reply, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  createCommentAction,
  deleteCommentAction,
  updateCommentAction,
} from '../actions'

export interface CommentNode {
  id: string
  body: string
  parentId: string | null
  isEdited: boolean
  editedAt: Date | null
  deletedAt: Date | null
  createdAt: Date
  author: { id: string; name: string; username: string; avatarColor: string }
}

/**
 * Threaded discussion.
 *
 * Replies nest one level — deeper nesting on a ticket makes the conversation
 * hard to follow, so a reply to a reply attaches to the same root.
 */
export function CommentThread({
  ticketId,
  comments,
  currentUserId,
  canModerate,
  mentionables,
}: {
  ticketId: string
  comments: CommentNode[]
  currentUserId: string
  canModerate: boolean
  mentionables: Array<{ id: string; name: string; username: string }>
}) {
  const roots = comments.filter((comment) => comment.parentId === null)
  const repliesByParent = new Map<string, CommentNode[]>()
  for (const comment of comments) {
    if (!comment.parentId) continue
    const bucket = repliesByParent.get(comment.parentId) ?? []
    bucket.push(comment)
    repliesByParent.set(comment.parentId, bucket)
  }

  const visibleCount = comments.filter((c) => !c.deletedAt).length

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" />
        Discussion
        {visibleCount > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
            {visibleCount}
          </span>
        )}
      </h2>

      <CommentComposer ticketId={ticketId} mentionables={mentionables} />

      {roots.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No comments yet. Start the conversation above.
        </p>
      ) : (
        <ul className="space-y-4">
          {roots.map((comment) => (
            <li key={comment.id}>
              <CommentItem
                comment={comment}
                ticketId={ticketId}
                currentUserId={currentUserId}
                canModerate={canModerate}
                mentionables={mentionables}
              />

              {(repliesByParent.get(comment.id)?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-3 border-l-2 pl-4">
                  {repliesByParent.get(comment.id)!.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem
                        comment={reply}
                        ticketId={ticketId}
                        currentUserId={currentUserId}
                        canModerate={canModerate}
                        mentionables={mentionables}
                        isReply
                      />
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

function CommentItem({
  comment,
  ticketId,
  currentUserId,
  canModerate,
  mentionables,
  isReply = false,
}: {
  comment: CommentNode
  ticketId: string
  currentUserId: string
  canModerate: boolean
  mentionables: Array<{ id: string; name: string; username: string }>
  isReply?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [replying, setReplying] = React.useState(false)
  const [body, setBody] = React.useState(comment.body)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const isAuthor = comment.author.id === currentUserId

  if (comment.deletedAt) {
    return (
      <div className="flex gap-2.5">
        <span className="size-7 shrink-0 rounded-full border border-dashed" />
        <p className="py-1.5 text-xs text-muted-foreground italic">
          This comment was deleted.
        </p>
      </div>
    )
  }

  function saveEdit() {
    startTransition(async () => {
      const result = await updateCommentAction({ commentId: comment.id, body })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteCommentAction({ commentId: comment.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setConfirmDelete(false)
      router.refresh()
    })
  }

  return (
    <div className="flex gap-2.5">
      <UserAvatar
        name={comment.author.name}
        color={comment.author.avatarColor}
        size={isReply ? 'sm' : 'md'}
        className="shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{comment.author.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
          </span>
          {comment.isEdited && (
            <span className="text-[11px] text-muted-foreground italic">edited</span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              disabled={isPending}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={isPending || !body.trim()}>
                {isPending && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBody(comment.body)
                  setEditing(false)
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <MentionText body={comment.body} />
        )}

        {!editing && (
          <div className="mt-1 flex items-center gap-0.5">
            {!isReply && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                onClick={() => setReplying((value) => !value)}
              >
                <Reply className="size-3" /> Reply
              </Button>
            )}
            {isAuthor && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3" /> Edit
              </Button>
            )}
            {(isAuthor || canModerate) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3" /> Delete
              </Button>
            )}
          </div>
        )}

        {replying && (
          <div className="mt-2">
            <CommentComposer
              ticketId={ticketId}
              parentId={comment.id}
              mentionables={mentionables}
              autoFocus
              placeholder={`Reply to ${comment.author.name}…`}
              onDone={() => setReplying(false)}
            />
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              The comment text is removed, but its place in the thread is kept so replies
              still make sense. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                remove()
              }}
              disabled={isPending}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CommentComposer({
  ticketId,
  parentId,
  mentionables,
  autoFocus,
  placeholder = 'Write a comment… use @ to mention someone',
  onDone,
}: {
  ticketId: string
  parentId?: string
  mentionables: Array<{ id: string; name: string; username: string }>
  autoFocus?: boolean
  placeholder?: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [body, setBody] = React.useState('')
  const [isPending, startTransition] = React.useTransition()
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Detect an in-progress @mention at the caret so we can offer completions.
  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    setBody(value)

    const caret = event.target.selectionStart
    const upToCaret = value.slice(0, caret)
    const match = /@([a-z0-9._-]*)$/i.exec(upToCaret)
    setMentionQuery(match ? match[1].toLowerCase() : null)
  }

  function applyMention(username: string) {
    const textarea = textareaRef.current
    if (!textarea) return

    const caret = textarea.selectionStart
    const upToCaret = body.slice(0, caret)
    const replaced = upToCaret.replace(/@([a-z0-9._-]*)$/i, `@${username} `)
    const next = replaced + body.slice(caret)

    setBody(next)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(replaced.length, replaced.length)
    })
  }

  const suggestions =
    mentionQuery === null
      ? []
      : mentionables
          .filter(
            (user) =>
              user.username.toLowerCase().includes(mentionQuery) ||
              user.name.toLowerCase().includes(mentionQuery),
          )
          .slice(0, 5)

  function submit() {
    if (!body.trim()) return

    startTransition(async () => {
      const result = await createCommentAction({
        ticketId,
        body,
        parentId: parentId ?? null,
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      setBody('')
      onDone?.()
      router.refresh()
    })
  }

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={textareaRef}
        value={body}
        onChange={handleChange}
        placeholder={placeholder}
        rows={parentId ? 2 : 3}
        disabled={isPending}
        autoFocus={autoFocus}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      />

      {suggestions.length > 0 && (
        <ul className="absolute z-20 max-h-48 w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {suggestions.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => applyMention(user.username)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">{user.name}</span>
                <span className="text-xs text-muted-foreground">@{user.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={isPending || !body.trim()}>
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          {parentId ? 'Reply' : 'Comment'}
        </Button>
        {onDone && (
          <Button size="sm" variant="ghost" onClick={onDone} disabled={isPending}>
            Cancel
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">⌘↵ to send</span>
      </div>
    </div>
  )
}

/** Renders @mentions as highlighted spans. */
function MentionText({ body }: { body: string }) {
  const parts = body.split(/(@[a-z0-9._-]{3,32})/gi)

  return (
    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.startsWith('@') ? (
          <span
            key={index}
            className={cn(
              'rounded bg-primary/10 px-1 font-medium text-primary',
            )}
          >
            {part}
          </span>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </p>
  )
}
