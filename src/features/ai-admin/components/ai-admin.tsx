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
import { UsageTimeline } from './usage-timeline'

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
        <Engines data={data} />
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
                copilotProvider: copilot === 'env' ? null : copilot,
                fixProvider: fix === 'auto' ? null : fix,
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

/**
 * Connected engines as full cards; everything else as a short, grouped list
 * that says what each costs and where it runs, so choosing one is informed.
 */
function Engines({ data }: { data: AiAdminPage }) {
  const [opened, setOpened] = React.useState<string[]>([])
  const connected = data.engines.filter((engine) => engine.keySource || opened.includes(engine.id))
  const others = data.engines.filter((engine) => !connected.includes(engine))
  const groups = [
    { title: 'Free', hint: 'A free tier you can use without paying — each with its own limits.', match: (e: AiAdminPage['engines'][number]) => e.definition.freeTier === 'permanent' },
    { title: 'Free credits, then paid', hint: '', match: (e: AiAdminPage['engines'][number]) => e.definition.freeTier === 'credits' },
    { title: 'Paid', hint: '', match: (e: AiAdminPage['engines'][number]) => !e.definition.freeTier && e.id !== 'custom' },
    { title: 'Your own', hint: '', match: (e: AiAdminPage['engines'][number]) => e.id === 'custom' },
  ]
  const card = (engine: AiAdminPage['engines'][number]) => (
    <EngineCard
      key={engine.id}
      engine={engine}
      catalogPage={data.priceCatalogPage}
      price={data.prices.find((p) => p.provider === engine.id && p.model === engine.model)}
    />
  )
  return (
    <div className="space-y-6">
      {connected.length > 0 ? connected.map(card) : <p className="text-sm text-muted-foreground">No engine is connected yet.</p>}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Add an engine</h2>
          <p className="text-xs text-muted-foreground">
            More engines mean more free capacity and cheaper fallbacks. Code and ticket text are sent to whichever engine
            runs — mind where each processes it before pointing a client&rsquo;s repository at it.
          </p>
        </div>
        {groups.map((group) => {
          const rows = others.filter(group.match)
          if (rows.length === 0) return null
          return (
            <div key={group.title} className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}{group.hint ? ` · ${group.hint}` : ''}</h3>
              <ul className="divide-y rounded-xl border">
                {rows.map((engine) => (
                  <li key={engine.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3 text-xs">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-medium">
                        {engine.label} <span className="text-xs font-normal text-muted-foreground">· {engine.definition.region}</span>
                      </p>
                      {engine.definition.freeNote && <p className="text-muted-foreground">{engine.definition.freeNote}</p>}
                      {engine.definition.dataNote && (
                        <p className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
                          <CircleAlert className="mt-px size-3 shrink-0" /> {engine.definition.dataNote}
                        </p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setOpened((ids) => [...ids, engine.id])}>
                      Connect
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function EngineCard({
  engine,
  price,
  catalogPage,
}: {
  engine: AiAdminPage['engines'][number]
  price?: AiAdminPage['prices'][number]
  catalogPage: string
}) {
  const { run, isPending } = useRun()
  const [model, setModel] = React.useState(engine.model)
  const [enabled, setEnabled] = React.useState(engine.enabled)
  const [plan, setPlan] = React.useState(engine.billingPlan)
  const [baseUrl, setBaseUrl] = React.useState(engine.baseUrl ?? '')
  const [customModel, setCustomModel] = React.useState(engine.id === 'custom' ? engine.model : '')
  const [key, setKey] = React.useState('')
  const [test, setTest] = React.useState<string | null>(null)
  // "Your rate": what the workspace actually pays, when it differs from list.
  const [rateIn, setRateIn] = React.useState(price?.customInputPerMTok == null ? '' : String(price.customInputPerMTok))
  const [rateOut, setRateOut] = React.useState(price?.customOutputPerMTok == null ? '' : String(price.customOutputPerMTok))
  const [rateDirty, setRateDirty] = React.useState(false)
  React.useEffect(() => {
    setRateIn(price?.customInputPerMTok == null ? '' : String(price.customInputPerMTok))
    setRateOut(price?.customOutputPerMTok == null ? '' : String(price.customOutputPerMTok))
    setRateDirty(false)
  }, [price?.customInputPerMTok, price?.customOutputPerMTok, model])

  const hasList = price && price.source === 'auto'
  const hasRate = price?.customInputPerMTok != null

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
        <span className="text-[11px] text-muted-foreground">{engine.definition.region}</span>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor={`on-${engine.id}`} className="text-xs text-muted-foreground">Enabled</Label>
          <Switch id={`on-${engine.id}`} checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      {(engine.definition.freeNote || engine.definition.dataNote) && (
        <div className="space-y-0.5 text-[11px]">
          {engine.definition.freeNote && <p className="text-muted-foreground">{engine.definition.freeNote}</p>}
          {engine.definition.dataNote && (
            <p className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
              <CircleAlert className="mt-px size-3 shrink-0" /> {engine.definition.dataNote}
            </p>
          )}
        </div>
      )}

      {engine.id === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Base URL (OpenAI-compatible, https)</Label>
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Model id</Label>
            <Input value={customModel} onChange={(event) => { setCustomModel(event.target.value); setModel(event.target.value) }} placeholder="the model name the endpoint expects" className="h-8 font-mono text-xs" />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn('space-y-1', engine.id === 'custom' && engine.models.models.length === 0 && 'hidden')}>
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

      <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs">How you pay</Label>
          <Select value={plan} onValueChange={(value) => setPlan(value as typeof plan)}>
            <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="free" className="text-xs">Free tier — nothing billed</SelectItem>
              <SelectItem value="list" className="text-xs">Pay as you go — list price</SelectItem>
              <SelectItem value="custom" className="text-xs">Custom rate — what we actually pay</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">
            {plan === 'free'
              ? 'Spend counts as $0; the list-price cost is still recorded, as the estimate for when the free tier ends.'
              : plan === 'custom'
                ? 'Spend uses your rate below, for a negotiated price or a subscription.'
                : 'Spend uses the list price.'}
          </span>
        </div>

        <p className="text-xs">
          <span className="text-muted-foreground">List price for {model}: </span>
          {hasList ? (
            <>
              <strong className="tabular-nums">${price!.inputPerMTok}</strong> in ·{' '}
              <strong className="tabular-nums">${price!.outputPerMTok}</strong> out per million tokens.{' '}
              <span className="text-muted-foreground">
                Source:{' '}
                <a href={catalogPage} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  LiteLLM&rsquo;s public model price catalogue
                </a>
                , fetched {new Date(price!.updatedAt).toISOString().slice(0, 10)}.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">not in the public catalogue yet — Refresh prices, or set your rate.</span>
          )}
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Your rate, input $ / 1M</Label>
            <Input value={rateIn} onChange={(event) => { setRateIn(event.target.value); setRateDirty(true) }} placeholder={hasList ? String(price!.inputPerMTok) : '0'} className="h-8 w-28 text-xs" inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Your rate, output $ / 1M</Label>
            <Input value={rateOut} onChange={(event) => { setRateOut(event.target.value); setRateDirty(true) }} placeholder={hasList ? String(price!.outputPerMTok) : '0'} className="h-8 w-28 text-xs" inputMode="decimal" />
          </div>
          <p className="pb-2 text-[11px] text-muted-foreground">
            {hasRate ? 'Your rate is set; refreshing list prices never changes it.' : 'Blank means the list price applies.'}
            {hasRate && (
              <button
                type="button"
                className="ml-2 text-primary hover:underline"
                disabled={isPending}
                onClick={() => run(() => revertToListPriceAction({ provider: engine.id, model }), () => toast.success('Your rate was cleared; the list price applies.'))}
              >
                Clear my rate
              </button>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const saved = await saveEngineAction({
                id: engine.id,
                model: engine.id === 'custom' ? customModel || model : model,
                enabled,
                billingPlan: plan,
                apiKey: key.trim() ? key.trim() : undefined,
                ...(engine.id === 'custom' ? { baseUrl: baseUrl.trim() || null } : {}),
              })
              if (!saved.success || !rateDirty) return saved
              if (!rateIn.trim() && !rateOut.trim()) return revertToListPriceAction({ provider: engine.id, model })
              return savePriceAction({ provider: engine.id, model, inputPerMTok: Number(rateIn) || 0, outputPerMTok: Number(rateOut) || 0 })
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
            onClick={() => run(() => saveEngineAction({ id: engine.id, model, enabled, billingPlan: plan, apiKey: '' }), () => toast.success('Stored key removed.'))}
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
  const days = range === 'month' ? data.daily.month : data.daily.last30
  const projected = data.projection

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Paid" value={usd(report.total.costUsd)} hint="after free tiers and your rates" />
        <Stat label="At list price" value={usd(report.total.listCostUsd)} hint="the same work, with no free tier" />
        <Stat
          label="This month, projected"
          value={projected.list === null ? '—' : usd(projected.list)}
          hint={projected.list === null ? 'needs a full day of use first' : `at list price · ${usd(projected.actual ?? 0)} paid, at this pace`}
        />
        <Stat
          label="Tokens"
          value={kTokens(report.total.inputTokens + report.total.outputTokens)}
          hint={`${report.total.calls} calls${projected.tokens !== null && range === 'month' ? ` · ~${kTokens(projected.tokens)} by month end` : ''}`}
        />
      </div>

      <UsageTimeline days={days} title={range === 'month' ? 'Each day this month' : 'Each day, last 30 days'} />

      {report.total.calls === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No AI calls in this period. Every Copilot turn, capture, filter, weekly update and AI run is counted from now on.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <UsageTable title="By person" rows={report.byUser} />
          <UsageTable title="By project" rows={report.byProject} />
          <UsageTable title="By engine and model" rows={report.byModel} />
          <UsageTable title="By feature" rows={report.byFeature} />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        The projection is this month&rsquo;s pace carried to the month&rsquo;s end. It will move as agents take on real volume.
      </p>
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
            <th className="py-1 text-right font-normal">Paid</th>
            <th className="py-1 text-right font-normal">At list</th>
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
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{usd(row.listCostUsd)}</td>
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
  const [provider, setProvider] = React.useState<string>(data.engines[0]?.id ?? 'anthropic')
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
            <Select value={provider} onValueChange={setProvider}>
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
