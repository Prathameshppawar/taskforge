'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { setAgentModelAction } from '@/features/ai-admin/actions'
import type { AgentModels as Data } from '../models'

/**
 * Workspace → AI → Agents: one engine and model per agent, with
 * recommendations from the engines this workspace has connected.
 */
export function AgentModels({ data }: { data: Data }) {
  if (data.engines.length === 0) {
    return <p className="text-sm text-muted-foreground">Connect an engine on the Engines tab first; agents choose among connected engines only.</p>
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Each agent can use the engine and model that suit its job. Recommendations come only from engines you have
        connected, ranked on the catalogue&rsquo;s capability facts, price, your billing plans — and, for the Coder, how many
        of its pull requests on each engine were actually merged.
      </p>
      {data.agents.map((agent) => (
        <AgentCard key={agent.role} agent={agent} engines={data.engines} />
      ))}
    </div>
  )
}

function AgentCard({ agent, engines }: { agent: Data['agents'][number]; engines: Data['engines'] }) {
  const router = useRouter()
  const [engineId, setEngineId] = React.useState(agent.current?.id ?? engines[0]?.id ?? '')
  const [model, setModel] = React.useState(agent.current?.model ?? '')
  const [isPending, startTransition] = React.useTransition()
  const models = engines.find((engine) => engine.id === engineId)?.models ?? []

  function save(next: { engineId: string | null; model: string | null }, message: string) {
    startTransition(async () => {
      const result = await setAgentModelAction({ agent: agent.role, ...next })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(message)
      router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{agent.label}</h3>
          <p className="text-xs text-muted-foreground">{agent.specialty}</p>
          <p className="text-[11px] text-muted-foreground">Used for: {agent.usedFor}</p>
        </div>
        <Badge variant={agent.assigned ? 'secondary' : 'outline'} className="text-[10px]">
          {agent.current ? `${agent.current.label} · ${agent.current.model}` : 'no engine'}
          {!agent.assigned && agent.current ? ' (workspace default)' : ''}
        </Badge>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Engine</Label>
          <Select value={engineId} onValueChange={(value) => { setEngineId(value); setModel(engines.find((engine) => engine.id === value)?.models[0] ?? '') }}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {engines.map((engine) => (
                <SelectItem key={engine.id} value={engine.id} className="text-xs">{engine.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <Label className="text-xs">Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-8 font-mono text-xs"><SelectValue placeholder="Choose a model" /></SelectTrigger>
            <SelectContent>
              {models.map((id) => (
                <SelectItem key={id} value={id} className="font-mono text-xs">{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-8" disabled={isPending || !engineId || !model} onClick={() => save({ engineId, model }, `${agent.label} set.`)}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        {agent.assigned && (
          <Button size="sm" variant="ghost" className="h-8" disabled={isPending} onClick={() => save({ engineId: null, model: null }, `${agent.label} uses the workspace default again.`)}>
            Use default
          </Button>
        )}
      </div>

      {agent.recommendations.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-xs font-medium">
            <Sparkles className="size-3.5 text-muted-foreground" /> Recommended for this job
          </p>
          <ol className="divide-y rounded-md border">
            {agent.recommendations.map((entry, index) => {
              const isCurrent = agent.current?.id === entry.engineId && agent.current?.model === entry.model
              return (
                <li key={`${entry.engineId}/${entry.model}`} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
                  <span className="w-4 text-muted-foreground tabular-nums">{index + 1}.</span>
                  <span className="font-medium">{entry.engineLabel}</span>
                  <span className="font-mono">{entry.model}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{entry.reasons.join(' · ')}</span>
                  {isCurrent ? (
                    <span className="text-[11px] text-muted-foreground">in use</span>
                  ) : (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={isPending}
                      onClick={() => save({ engineId: entry.engineId, model: entry.model }, `${agent.label} now uses ${entry.model}.`)}>
                      Apply
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
