'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { reindexMemoryAction, setProjectToggleAction, type ProjectToggle } from '../actions'

const ROWS: Array<{ key: ProjectToggle; label: string; hint: string; cost: string }> = [
  {
    key: 'memoryEnabled',
    label: 'Project memory',
    hint: 'Index finished tickets, the repositories’ docs and the handbook, so the Copilot and the agents can find how something was done before.',
    cost: 'Free — embedded in-process. Uses database space: capped at 3,000 pieces per project.',
  },
  {
    key: 'handbookAutoRefresh',
    label: 'Refresh the handbook every Monday',
    hint: 'A new version each week, so it keeps up with the project.',
    cost: 'One AI call a week on the Release Manager’s engine (free on Groq).',
  },
  {
    key: 'triageAgent',
    label: 'TaskForge Triage',
    hint: 'Fill in what a new ticket left at its defaults — type, priority, labels, points, an assignee — with the reasons in a comment, and one-click undo. It never overwrites what a person chose.',
    cost: 'One AI call per new ticket on the Copilot’s engine.',
  },
  {
    key: 'dailyDigest',
    label: 'Morning digest',
    hint: 'Each morning, the managers get what is stuck, at risk, due, and waiting on the client — by email and in linked Teams channels.',
    cost: 'Free — no AI, one email a day.',
  },
  {
    key: 'liveUpdates',
    label: 'Live updates',
    hint: 'The board and table refresh when someone else changes a ticket.',
    cost: 'A light check every 20 seconds while a tab is open and visible — counts against the hosting plan’s function calls, which is why it is off by default.',
  },
]

export function AutomationSettings({
  projectId,
  values,
  memory,
  canEdit,
}: {
  projectId: string
  values: Record<ProjectToggle, boolean>
  memory: Record<string, number>
  canEdit: boolean
}) {
  const router = useRouter()
  const [local, setLocal] = React.useState(values)
  const [pending, startTransition] = React.useTransition()
  React.useEffect(() => setLocal(values), [values])
  const total = Object.values(memory).reduce((sum, value) => sum + value, 0)

  return (
    <section className="space-y-3" aria-labelledby="automation-heading">
      <div>
        <h2 id="automation-heading" className="text-sm font-semibold">Automation</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Everything here stays within free tiers; each switch says what it costs.</p>
      </div>
      <ul className="divide-y rounded-xl border">
        {ROWS.map((row) => (
          <li key={row.key} className="flex items-start justify-between gap-4 p-3">
            <div className="space-y-0.5">
              <Label htmlFor={`toggle-${row.key}`}>{row.label}</Label>
              <p className="text-xs text-muted-foreground">{row.hint}</p>
              <p className="text-[11px] text-muted-foreground/80">{row.cost}</p>
              {row.key === 'memoryEnabled' && local.memoryEnabled && (
                <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                  <span>
                    {total} pieces indexed
                    {total > 0 && ` (${memory.TICKET ?? 0} tickets, ${memory.REPO_DOC ?? 0} from docs, ${memory.HANDBOOK ?? 0} handbook)`}
                  </span>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await reindexMemoryAction(projectId)
                          if (!result.success) toast.error(result.error)
                          else {
                            toast.success(`Indexed ${result.data.chunks} pieces (${result.data.embedded} new or changed).`)
                            router.refresh()
                          }
                        })
                      }
                    >
                      {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Reindex now
                    </Button>
                  )}
                </div>
              )}
            </div>
            <Switch
              id={`toggle-${row.key}`}
              checked={local[row.key]}
              disabled={!canEdit || pending}
              onCheckedChange={(value) => {
                setLocal((current) => ({ ...current, [row.key]: value }))
                startTransition(async () => {
                  const result = await setProjectToggleAction({ projectId, key: row.key, value })
                  if (!result.success) {
                    setLocal((current) => ({ ...current, [row.key]: !value }))
                    toast.error(result.error)
                  } else router.refresh()
                })
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
