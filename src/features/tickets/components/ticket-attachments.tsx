'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileText, ImageIcon, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  deleteAttachmentAction,
  uploadAttachmentAction,
} from '@/features/attachments/actions'
import {
  formatBytes,
  isInlineType,
  MAX_ATTACHMENT_BYTES,
} from '@/features/attachments/service'

export interface TicketAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: Date
  uploadedBy: { name: string; avatarColor: string } | null
}

/**
 * Files on a ticket.
 *
 * Images preview inline; everything else is a download. That split is a
 * security decision rather than a presentational one — see
 * `features/attachments/service.ts`, which is also why SVG lands on the
 * download side despite being an image.
 */
export function TicketAttachments({
  ticketId,
  attachments,
  canEdit,
}: {
  ticketId: string
  attachments: TicketAttachment[]
  canEdit: boolean
}) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = React.useTransition()
  const [dragging, setDragging] = React.useState(false)

  function upload(files: FileList | null) {
    if (!files?.length) return

    const file = files[0]
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(
        `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      )
      return
    }

    const form = new FormData()
    form.set('ticketId', ticketId)
    form.set('file', file)

    startTransition(async () => {
      const result = await uploadAttachmentAction(form)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Attached ${result.data.filename}.`)
      router.refresh()
    })
  }

  if (attachments.length === 0 && !canEdit) return null

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip className="size-4 text-muted-foreground" />
          Attachments
        </h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          upload(event.target.files)
          // Reset, so re-picking the same file fires change again.
          event.target.value = ''
        }}
      />

      {attachments.length === 0 ? (
        canEdit && (
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              upload(event.dataTransfer.files)
            }}
            className={`rounded-md border border-dashed p-4 text-center text-xs transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'text-muted-foreground'
            }`}
          >
            Drop a file here, or use Upload. Up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.
          </div>
        )
      ) : (
        <ul className="divide-y rounded-md border">
          {attachments.map((attachment) => {
            const previewable = isInlineType(attachment.contentType)
            const Icon = previewable ? ImageIcon : FileText

            return (
              <li key={attachment.id} className="flex items-center gap-2.5 px-2.5 py-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />

                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/attachments/${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs hover:underline"
                  >
                    {attachment.filename}
                  </a>
                  <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {formatBytes(attachment.size)}
                    {attachment.uploadedBy && (
                      <>
                        ·
                        <UserAvatar
                          name={attachment.uploadedBy.name}
                          color={attachment.uploadedBy.avatarColor}
                          size="sm"
                          className="size-3.5"
                        />
                        {attachment.uploadedBy.name}
                      </>
                    )}
                  </p>
                </div>

                <a
                  href={`/api/attachments/${attachment.id}`}
                  download={attachment.filename}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Download ${attachment.filename}`}
                >
                  <Download className="size-3.5" />
                </a>

                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 shrink-0 p-0 text-muted-foreground"
                    aria-label={`Remove ${attachment.filename}`}
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await deleteAttachmentAction(attachment.id)
                        if (!result.success) {
                          toast.error(result.error)
                          return
                        }
                        router.refresh()
                      })
                    }
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
