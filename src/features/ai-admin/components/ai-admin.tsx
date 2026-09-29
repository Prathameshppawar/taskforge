'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, CircleCheck, KeyRound, Loader2, Mail, Plus, Send, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  refreshPricesAction,
  revertToListPriceAction,
  deleteBudgetAction,
  saveBudgetAction,
  saveEngineAction,
  savePriceAction,
  saveWorkspaceAiAction,
  sendReportNowAction,
  subscribeAction,
  testEngineAction,
  unsubscribeAction,
} from '../actions'
import type { AiAdminPage } from '../queries'
import type { UsageRow } from '../reports'
import { AgentRoster } from '@/features/agents/components/agent-roster'

type Result<T> = { success: true; data: T } | { success: false; error: string }

function useRun() {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const run = React.useCallback(
    <T,>(work: () => Promise<Result<T>>, done?: (data: T) => void) =>
      startTransition(async () => {
        const result = await work()
        if (!result.success) {
          toast.error(result.error)
          return
        }
        done?.(result.data)
        router.refresh()
      }),
    [router],
  )
  return { run, isPending }
}

const usd = (value: number) => (value > 0 && value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`)
const kTokens = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : `${(value / 1000).toFixed(1)}k`)

export function AiAdmin({ data }: { data: AiAdminPage }) {
  return (
    <Tabs defaultValue="engines" className="space-y-4">
      <TabsList>
        <TabsTrigger value="engines">Engines</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="budgets">Budgets</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
      </TabsList>
      <TabsContent value="engines" className="space-y-6">
        <WorkspaceChoice data={data} />
        {data.engines.map((engine) => (
          <EngineCard key={engine.id} engine={engine} price={data.prices.find((p) => p.provider === engine.id && p.model === engine.model)} />
        ))}
      </TabsContent>
      <TabsContent value="usage" className="space-y-6">
        <Usage data={data} />
      </TabsContent>
      <TabsContent value="budgets" className="space-y-6">
        <Budgets data={data} />
      </TabsContent>
      <TabsContent value="reports" className="space-y-6">
        <Reports data={data} />
      </TabsContent>
      <TabsContent value="agents" className="space-y-6">
        <AgentRoster data={data.agents} />
      </TabsContent>
    </Tabs>
  )
}

// -----------------------------------------------------------------------------
// Engines
// -----------------------------------------------------------------------------

function WorkspaceChoice({ data }: { data: AiAdminPage }) {
  const { run, isPending } = useRun()
  const usable = data.engines.filter((engine) => engine.enabled && engine.keySource)
  const [copilot, setCopilot] = React.useState(data.workspace.copilotProvider ?? 'env')
  const [fix, setFix] = React.useState(data.workspace.fixProvider ?? 'auto')

  return (
    <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label className="text-xs">Copilot, capture, filters and weekly update use</Label>
        <Select value={copilot} onValueChange={setCopilot}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="env" className="text-xs">The environment default (AI_PROVIDER)</SelectItem>
            {usable.map((engine) => (
              <SelectItem key={engine.id} value={engine.id} className="text-xs">{engine.label} · {engine.model}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Fix with AI offers first</Label>
        <Select value={fix} onValueChange={setFix}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto" className="text-xs">The most capable available</SelectItem>
            {usable.map((engine) => (
              <SelectItem key={engine.id} value={engine.id} className="text-xs">{engine.label} · {engine.model}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        title="Fetch current list prices for every Anthropic, OpenAI and Groq model. Prices set by hand are kept."
        onClick={() =>
          run(() => refreshPricesAction(), (result) =>
            toast.success(`${result.updated} list prices refreshed${result.kept ? `, ${result.kept} set by hand kept` : ''}.`),
          )
        }
      >
        Refresh prices
      </Button>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          run(
            () =>
              saveWorkspaceAiAction({
                copilotProvider: copilot === 'env' ? null : (copilot as 'anthropic' | 'openai' | 'groq'),
                fixProvider: fix === 'auto' ? null : (fix as 'anthropic' | 'openai' | 'groq'),
              }),
            () => toast.success('Saved.'),
          )
        }
      >
        Save
      </Button>
      </div>
    </section>
  )
}

function EngineCard({
  engine,
  price,
}: {
  engine: AiAdminPage['engines'][number]
  price?: AiAdminPage['prices'][number]
}) {
  const { run, isPending } = useRun()
  const [model, setModel] = React.useState(engine.model)
  const [enabled, setEnabled] = React.useState(engine.enabled)
  const [key, setKey] = React.useState('')
  const [input, setInput] = React.useState(String(price?.inputPerMTok ?? 0))
  const [output, setOutput] = React.useState(String(price?.outputPerMTok ?? 0))
  // Only a price someone actually edited is saved (and so marked as set by
  // hand); saving a model change must not freeze its list price.
  const [priceDirty, setPriceDirty] = React.useState(false)
  React.useEffect(() => {
    setInput(String(price?.inputPerMTok ?? 0))
    setOutput(String(price?.outputPerMTok ?? 0))
    setPriceDirty(false)
  }, [price?.inputPerMTok, price?.outputPerMTok, model])
  const [test, setTest] = React.useState<string | null>(null)

  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{engine.label}</h2>
        {engine.keySource ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <KeyRound className="size-3" />
            key …{engine.keyHint} · {engine.keySource === 'settings' ? 'saved here' : `from ${engine.envKey}`}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">no key</Badge>
        )}
        {!engine.enabled && <Badge variant="outline" className="text-[10px]">off</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor={`on-${engine.id}`} className="text-xs text-muted-foreground">Enabled</Label>
          <Switch id={`on-${engine.id}`} checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">
            Model{' '}
            <span className="text-muted-foreground">
              {engine.models.live ? `(${engine.models.models.length} available to this key)` : '(suggested — add a key to see live models)'}
            </span>
          </Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-8 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {engine.models.models.map((id) => (
                <SelectItem key={id} value={id} className="font-mono text-xs">{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            API key{' '}
            <a href={engine.keysUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">get one</a>
          </Label>
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={engine.keySource ? 'Leave blank to keep the current key' : 'Paste a key'}
            className="h-8 font-mono text-xs"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Input $ / 1M tokens</Label>
          <Input value={input} onChange={(event) => { setInput(event.target.value); setPriceDirty(true) }} className="h-8 w-28 text-xs" inputMode="decimal" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Output $ / 1M tokens</Label>
          <Input value={output} onChange={(event) => { setOutput(event.target.value); setPriceDirty(true) }} className="h-8 w-28 text-xs" inputMode="decimal" />
        </div>
        <p className="pb-2 text-[11px] text-muted-foreground">
          {!price
            ? 'No price for this model yet — Save or Refresh prices to fetch its list price.'
            : price.source === 'auto'
              ? `List price, from the public catalogue · updated ${new Date(price.updatedAt).toISOString().slice(0, 10)}`
              : 'Set by hand — refreshes leave it alone.'}
          {price?.source === 'manual' && (
            <button
              type="button"
              className="ml-2 text-primary hover:underline"
              disabled={isPending}
              onClick={() => run(() => revertToListPriceAction({ provider: engine.id, model }), () => toast.success('Back to the list price.'))}
            >
              Use list price
            </button>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const saved = await saveEngineAction({ id: engine.id, model, enabled, apiKey: key.trim() ? key.trim() : undefined })
              if (!saved.success || !priceDirty) return saved
              return savePriceAction({ provider: engine.id, model, inputPerMTok: Number(input) || 0, outputPerMTok: Number(output) || 0 })
            }, () => {
              setKey('')
              toast.success(`${engine.label} saved.`)
            })
          }
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !engine.keySource}
          onClick={() => {
            setTest('…')
            run(() => testEngineAction(engine.id), (result) => setTest(`${result.reply} · ${result.ms} ms`))
          }}
        >
          <Zap className="size-4" />
          Test
        </Button>
        {engine.keySource === 'settings' && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={isPending}
            onClick={() => run(() => saveEngineAction({ id: engine.id, model, enabled, apiKey: '' }), () => toast.success('Stored key removed.'))}
          >
            Remove stored key
          </Button>
        )}
        {test && <span className="text-xs text-muted-foreground">Reply: {test}</span>}
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Usage
// -----------------------------------------------------------------------------

function Usage({ data }: { data: AiAdminPage }) {
  const [range, setRange] = React.useState<'month' | 'last30'>('month')
  const report = range === 'month' ? data.month : data.last30

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Select value={range} onValueChange={(value) => setRange(value as 'month' | 'last30')}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month" className="text-xs">This month</SelectItem>
            <SelectItem value="last30" className="text-xs">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Spend" value={usd(report.total.costUsd)} />
        <Stat label="Tokens" value={kTokens(report.total.inputTokens + report.total.outputTokens)} hint={`${kTokens(report.total.inputTokens)} in · ${kTokens(report.total.outputTokens)} out`} />
        <Stat label="Model calls" value={String(report.total.calls)} />
      </div>

      {report.total.calls === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No AI calls in this period. Every Copilot turn, capture, filter, weekly update and AI fix is counted from now on.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <UsageTable title="By person" rows={report.byUser} />
          <UsageTable title="By project" rows={report.byProject} />
          <UsageTable title="By engine and model" rows={report.byModel} />
          <UsageTable title="By feature" rows={report.byFeature} />
        </div>
      )}
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{hint}</p>}
    </div>
  )
}

/**
 * A ranked table with one proportion bar per row. The bar is magnitude only —
 * one hue, measured against the largest row by tokens so it reads even while
 * prices are unset — and every number it stands for is printed beside it.
 */
function UsageTable({ title, rows }: { title: string; rows: UsageRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.inputTokens + row.outputTokens))
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">Name</th>
            <th className="py-1 text-right font-normal">Calls</th>
            <th className="py-1 text-right font-normal">Tokens</th>
            <th className="py-1 text-right font-normal">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row) => {
            const total = row.inputTokens + row.outputTokens
            return (
              <tr key={row.key} className="border-t" title={`${row.label}: ${total.toLocaleString()} tokens, ${usd(row.costUsd)}`}>
                <td className="py-1.5 pr-2">
                  <span className="block truncate">{row.label}</span>
                  <span className="mt-1 block h-1 rounded-full bg-muted">
                    <span className="block h-1 rounded-full bg-primary/70" style={{ width: `${Math.max(2, (total / max) * 100)}%` }} />
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{row.calls}</td>
                <td className="py-1.5 text-right tabular-nums">{kTokens(total)}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{usd(row.costUsd)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Budgets
// -----------------------------------------------------------------------------

function Budgets({ data }: { data: AiAdminPage }) {
  const { run, isPending } = useRun()
  const [scope, setScope] = React.useState<'WORKSPACE' | 'PROJECT' | 'PROVIDER'>('WORKSPACE')
  const [projectId, setProjectId] = React.useState(data.projects[0]?.id ?? '')
  const [provider, setProvider] = React.useState<'anthropic' | 'openai' | 'groq'>('anthropic')
  const [limit, setLimit] = React.useState('50')
  const [hardStop, setHardStop] = React.useState(false)

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Monthly limits, reset on the 1st. Subscribers to <em>Budget alerts</em> are emailed at 80% and again at 100%. A
        budget with <strong>hard stop</strong> also refuses new Copilot turns and AI fixes in its scope once it is spent;
        without it, nothing is ever blocked.
      </p>

      {data.budgets.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {data.budgets.map((budget) => {
            const tone = budget.percent >= 100 ? 'critical' : budget.percent >= 80 ? 'warning' : 'good'
            return (
              <li key={budget.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {budget.scope === 'WORKSPACE'
                      ? 'Whole workspace'
                      : budget.scope === 'PROJECT'
                        ? `${budget.project?.name} (${budget.project?.code})`
                        : `${budget.provider} engine`}
                  </span>
                  {budget.hardStop && <Badge variant="outline" className="text-[10px]">hard stop</Badge>}
                  <span className="ml-auto flex items-center gap-1 text-xs tabular-nums">
                    {tone === 'good' ? (
                      <CircleCheck className="size-3.5 text-emerald-600" />
                    ) : (
                      <CircleAlert className={cn('size-3.5', tone === 'critical' ? 'text-destructive' : 'text-amber-600')} />
                    )}
                    {usd(budget.spentUsd)} of {usd(budget.limitUsd)} · {budget.percent}%
                    {tone === 'critical' ? ' · reached' : tone === 'warning' ? ' · nearly spent' : ''}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Remove budget"
                    disabled={isPending}
                    onClick={() => run(() => deleteBudgetAction(budget.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div
                  className="h-1.5 rounded-full bg-muted"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(budget.percent, 100)}
                  aria-label="Budget used"
                >
                  <div
                    className={cn(
                      'h-1.5 rounded-full',
                      tone === 'critical' ? 'bg-destructive' : tone === 'warning' ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(100, Math.max(budget.percent, 1))}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/20 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Applies to</Label>
          <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="WORKSPACE" className="text-xs">Whole workspace</SelectItem>
              <SelectItem value="PROJECT" className="text-xs">One project</SelectItem>
              <SelectItem value="PROVIDER" className="text-xs">One engine</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === 'PROJECT' && (
          <div className="space-y-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id} className="text-xs">{project.name} ({project.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {scope === 'PROVIDER' && (
          <div className="space-y-1">
            <Label className="text-xs">Engine</Label>
            <Select value={provider} onValueChange={(value) => setProvider(value as typeof provider)}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.engines.map((engine) => (
                  <SelectItem key={engine.id} value={engine.id} className="text-xs">{engine.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Monthly limit ($)</Label>
          <Input value={limit} onChange={(event) => setLimit(event.target.value)} className="h-8 w-28 text-xs" inputMode="decimal" />
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <Switch id="hard-stop" checked={hardStop} onCheckedChange={setHardStop} />
          <Label htmlFor="hard-stop" className="text-xs">Hard stop</Label>
        </div>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(
              () =>
                saveBudgetAction({
                  scope,
                  projectId: scope === 'PROJECT' ? projectId : null,
                  provider: scope === 'PROVIDER' ? provider : null,
                  monthlyLimitUsd: Number(limit),
                  hardStop,
                }),
              () => toast.success('Budget saved.'),
            )
          }
        >
          <Plus className="size-4" />
          Save budget
        </Button>
      </div>
    </>
  )
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

const KINDS = [
  { value: 'AI_USAGE_WEEKLY', label: 'Weekly AI usage', hint: 'Mondays: last week by person, project, engine and feature.' },
  { value: 'AI_BUDGET_ALERT', label: 'Budget alerts', hint: 'When any budget reaches 80% and 100%.' },
] as const

function Reports({ data }: { data: AiAdminPage }) {
  const { run, isPending } = useRun()
  const [kind, setKind] = React.useState<(typeof KINDS)[number]['value']>('AI_USAGE_WEEKLY')
  const [target, setTarget] = React.useState('')

  return (
    <>
      {!data.emailConfigured && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-amber-600" />
          Email is not configured on this server (EMAIL_HOST, EMAIL_USER, EMAIL_PASS), so subscriptions are saved but nothing is sent.
        </p>
      )}

      {KINDS.map((entry) => {
        const subs = data.subscriptions.filter((sub) => sub.kind === entry.value)
        return (
          <section key={entry.value} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{entry.label}</h3>
                <p className="text-xs text-muted-foreground">{entry.hint}</p>
              </div>
              {entry.value === 'AI_USAGE_WEEKLY' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending || subs.length === 0 || !data.emailConfigured}
                  onClick={() => run(() => sendReportNowAction(), (result) => toast.success(`Sent to ${result.recipients}.`))}
                >
                  <Send className="size-4" />
                  Send last week&rsquo;s now
                </Button>
              )}
            </div>
            {subs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody subscribed.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {subs.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <Mail className="size-3.5 text-muted-foreground" />
                    {sub.user ? (
                      <span>{sub.user.name} <span className="text-muted-foreground">{sub.user.email}</span></span>
                    ) : (
                      <span>Team {sub.team?.name} <span className="text-muted-foreground">· {sub.team?._count.members} people</span></span>
                    )}
                    <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="Unsubscribe" disabled={isPending} onClick={() => run(() => unsubscribeAction(sub.id))}>
                      <Trash2 className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/20 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Report</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {KINDS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value} className="text-xs">{entry.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Send to</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-8 w-60 text-xs"><SelectValue placeholder="A person or a team" /></SelectTrigger>
            <SelectContent>
              {data.teams.map((team) => (
                <SelectItem key={team.id} value={`team:${team.id}`} className="text-xs">Team · {team.name}</SelectItem>
              ))}
              {data.users.map((user) => (
                <SelectItem key={user.id} value={`user:${user.id}`} className="text-xs">{user.name} · {user.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={isPending || !target}
          onClick={() => {
            const [type, id] = target.split(':')
            run(() => subscribeAction({ kind, userId: type === 'user' ? id : null, teamId: type === 'team' ? id : null }), () => {
              setTarget('')
              toast.success('Subscribed.')
            })
          }}
        >
          <Plus className="size-4" />
          Subscribe
        </Button>
      </div>
    </>
  )
}
