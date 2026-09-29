'use client'

import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { DailyUsage } from '../reports'

/**
 * AI usage per day: tokens, and what they cost.
 *
 * Two charts on one shared day axis rather than one chart with two y-scales.
 * Tokens and dollars have unrelated units, and a dual-axis chart invites the
 * eye to compare heights that mean nothing against each other — so each gets
 * its own axis, and the hover is synchronised (`syncId`) so pointing at a day
 * in either shows that day in both.
 *
 * Colours are the app's validated chart tokens: tokens in slot 1; list price
 * and paid in slots 2 and 3, the adjacent pair checked for colour-blind
 * separation. Slot 3 is below 3:1 contrast on the light surface, so "Paid" is
 * also dashed, the legend names both lines, and the tables below are the
 * table view.
 */

const AXIS = { stroke: 'var(--color-muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const

const dayLabel = (value: string | number | undefined) =>
  typeof value === 'string'
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : String(value ?? '')

const money = (value: number) => (value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`)
/** Axis ticks with only as many decimals as the scale needs, so sub-cent days do not print "$0.00" four times. */
const moneyTick = (value: number) =>
  value === 0 ? '$0' : value < 0.01 ? `$${value.toFixed(4)}` : value < 1 ? `$${value.toFixed(2)}` : `$${Math.round(value)}`
const tokens = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value))

function Hover({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string
  format: (value: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{dayLabel(label)}</p>
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={entry.name} className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: entry.color }} aria-hidden />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">{format(Number(entry.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function UsageTimeline({ days, title }: { days: DailyUsage[]; title: string }) {
  const totalTokens = days.reduce((sum, day) => sum + day.tokens, 0)
  const totalList = days.reduce((sum, day) => sum + day.listCostUsd, 0)
  const totalPaid = days.reduce((sum, day) => sum + day.costUsd, 0)

  return (
    <figure className="space-y-2 rounded-xl border bg-card p-4">
      <figcaption>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">
          {tokens(totalTokens)} tokens · {money(totalList)} at list price · {money(totalPaid)} paid. Hover a day to see both
          charts&rsquo; figures for it.
        </p>
      </figcaption>

      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={days} syncId="ai-usage" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis dataKey="day" {...AXIS} tickFormatter={dayLabel} minTickGap={24} />
          <YAxis {...AXIS} width={64} tickFormatter={tokens} allowDecimals={false} />
          <Tooltip content={<Hover format={tokens} />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
          <Bar dataKey="tokens" name="Tokens" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>

      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={days} syncId="ai-usage" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
          {/* scale="band" places each day in the same slot the bar chart above
              uses, so the two x-axes line up day for day. */}
          <XAxis dataKey="day" {...AXIS} tickFormatter={dayLabel} minTickGap={24} scale="band" />
          <YAxis {...AXIS} width={64} tickFormatter={moneyTick} />
          <Tooltip content={<Hover format={money} />} cursor={{ stroke: 'var(--color-muted-foreground)', strokeOpacity: 0.3 }} />
          <Legend verticalAlign="top" align="right" height={20} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <Line type="linear" dataKey="listCostUsd" name="At list price" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line type="linear" dataKey="costUsd" name="Paid" stroke="var(--color-chart-3)" strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  )
}
