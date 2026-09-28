'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { draftReleaseNotesAction } from '../actions'

/**
 * On a Deployment ticket: what this release contains, and a button to have the
 * Release Manager write it up — optionally as a GitHub release.
 */
export function ReleasePanel({
  ticketId,
  pending,
  since,
  canPublish,
}: {
  ticketId: string
  pending: Array<{ key: string; title: string }>
  since: string
  canPublish: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function run(publish: boolean) {
    startTransition(async () => {
      const result = await draftReleaseNotesAction({ ticketId, publish })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.data.release
          ? `Published ${result.data.release.tag} with ${result.data.count} changes.`
          : `Release notes posted: ${result.data.count} changes.`,
      )
      router.refresh()
    })
  }

  return (
    <section className="space-y-2" aria-labelledby="release-heading">
      <h2 id="release-heading" className="flex items-center gap-1.5 text-sm font-medium">
        <PackageCheck className="size-4 text-muted-foreground" />
        In this release
        <span className="text-xs font-normal text-muted-foreground">· finished since {since}</span>
      </h2>
      {pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing has been finished since the previous release.</p>
      ) : (
        <>
          <ul className="divide-y rounded-md border text-xs">
            {pending.slice(0, 12).map((ticket) => (
              <li key={ticket.key} className="flex gap-2 px-2.5 py-1.5">
                <span className="shrink-0 font-mono text-muted-foreground">{ticket.key}</span>
                <span className="min-w-0 truncate">{ticket.title}</span>
              </li>
            ))}
            {pending.length > 12 && <li className="px-2.5 py-1.5 text-muted-foreground">and {pending.length - 12} more</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => run(false)}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Draft release notes
            </Button>
            {canPublish && (
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(true)}>
                Draft and publish a GitHub release
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
