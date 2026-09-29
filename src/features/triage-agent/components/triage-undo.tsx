'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { undoTriageAction } from '../actions'

/** What TaskForge Triage set on this ticket, and a way to put it back. */
export function TriageUndo({ run, canEdit }: { run: { id: string; summary: string } | null; canEdit: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  if (!run) return null
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
      <p>
        <span className="font-medium">TaskForge Triage</span> set {run.summary}.
      </p>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await undoTriageAction(run.id)
              if (!result.success) toast.error(result.error)
              else {
                toast.success(result.data.kept.length ? `Undone, except what people changed since: ${result.data.kept.join('; ')}.` : 'Undone.')
                router.refresh()
              }
            })
          }
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />} Undo
        </Button>
      )}
    </div>
  )
}
