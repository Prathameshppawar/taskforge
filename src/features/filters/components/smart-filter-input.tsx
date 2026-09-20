'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { interpretFilterAction } from '../actions'
import { filtersToSearchParams } from '../types'

/**
 * Describe a view in words; get the real filter.
 *
 * The result is an ordinary filter written into the URL, not a private query —
 * so every chip is visible in the toolbar, wrong guesses can be corrected by
 * hand, and the view can be saved or shared like any other. That is the whole
 * reason the model returns names for the server to resolve rather than
 * returning results directly.
 */
export function SmartFilterInput({ projectId }: { projectId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [value, setValue] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  function submit() {
    const request = value.trim()
    if (request.length < 3) return

    startTransition(async () => {
      const result = await interpretFilterAction({ request, projectId })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      const { filters, summary, unresolved } = result.data

      if (summary.length === 0) {
        toast.error('Nothing in that matched a filter. Try naming a person, status or label.')
        return
      }

      // Said out loud, because a filter that silently ignored half the request
      // is worse than one that admits it.
      toast.success(`Showing: ${summary.join(' · ')}`, {
        description: unresolved.length > 0 ? unresolved.join(' · ') : undefined,
      })

      router.replace(`${pathname}?${filtersToSearchParams(filters).toString()}`, {
        scroll: false,
      })
      setValue('')
    })
  }

  return (
    <div className="relative">
      {isPending ? (
        <Loader2 className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : (
        <Sparkles className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        value={value}
        disabled={isPending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        placeholder="Describe a view…"
        aria-label="Describe the tickets you want to see"
        className="h-8 w-56 pl-8 text-xs"
      />
    </div>
  )
}
