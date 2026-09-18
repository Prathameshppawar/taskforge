'use client'

import * as React from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '@/lib/utils'
import type { DistributionSlice, TrendPoint, WorkloadRow } from '../queries'

/**
 * Chart set.
 *
 * Colour follows the validated token palette in globals.css:
 *   • categorical hues in fixed order, never cycled
 *   • an ordinal single-hue ramp for priority, which is ordered by severity
 *   • recessive grid and axes, thin marks, 2px gaps between adjacent fills
 * Every chart ships a tooltip; charts with two or more series ship a legend, so
 * identity is never carried by colour alone.
 */

const AXIS_PROPS = {
  stroke: 'var(--color-muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const

function ChartFrame({
  title,
  description,
  children,
  className,
  action,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
}) {
  return (
    <figure className={cn('rounded-xl border bg-card p-4', className)}>
      <figcaption className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </figcaption>
      {children}
    </figure>
  )
}

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: unknown }>
  label?: string | number
  formatter?: (label: string | number | undefined) => string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-md">
      {label !== undefined && (
        <p className="mb-1 font-medium">{formatter ? formatter(label) : label}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li key={index} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Created vs completed over time — two series, so it carries a legend. */
export function TicketTrendChart({ data }: { data: TrendPoint[] }) {
  const formatDay = (value: string | number | undefined) => {
    if (typeof value !== 'string') return String(value ?? '')
    const date = new Date(`${value}T00:00:00`)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const totalCreated = data.reduce((sum, point) => sum + point.created, 0)
  const totalCompleted = data.reduce((sum, point) => sum + point.completed, 0)

  return (
    <ChartFrame
      title="Ticket trend"
      description={`Last ${data.length} days · ${totalCreated} created, ${totalCompleted} completed`}
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            {...AXIS_PROPS}
            tickFormatter={(value) => formatDay(value)}
            minTickGap={28}
          />
          <YAxis {...AXIS_PROPS} allowDecimals={false} width={44} />
          <Tooltip
            content={<TooltipBox formatter={formatDay} />}
            cursor={{ stroke: 'var(--color-muted-foreground)', strokeOpacity: 0.3 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={24}
            iconType="plainline"
            wrapperStyle={{ fontSize: 11 }}
          />

          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            fill="url(#fillCreated)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Area
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke="var(--color-chart-3)"
            strokeWidth={2}
            fill="url(#fillCompleted)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/**
 * Priority distribution.
 *
 * Priority is ordered by severity, so this uses the single-hue ordinal ramp
 * (light → dark) rather than categorical hues — the ramp encodes the ordering
 * that categorical colour would throw away.
 */
const RAMP = [
  'var(--color-ramp-1)',
  'var(--color-ramp-2)',
  'var(--color-ramp-3)',
  'var(--color-ramp-4)',
  'var(--color-ramp-5)',
]

export function PriorityChart({ data }: { data: DistributionSlice[] }) {
  if (data.length === 0) {
    return (
      <ChartFrame title="Priority distribution">
        <EmptyChart />
      </ChartFrame>
    )
  }

  return (
    <ChartFrame title="Priority distribution" description="Ordered low to high severity">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis dataKey="name" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} width={44} />
          <Tooltip
            content={<TooltipBox />}
            cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.4 }}
          />
          <Bar dataKey="count" name="Tickets" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((slice, index) => (
              <Cell key={slice.id} fill={RAMP[Math.min(index, RAMP.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/** Tickets per label — one series, so no legend; the title names it. */
export function LabelChart({ data }: { data: DistributionSlice[] }) {
  if (data.length === 0) {
    return (
      <ChartFrame title="Tickets by label">
        <EmptyChart message="No labels have been applied yet." />
      </ChartFrame>
    )
  }

  return (
    <ChartFrame title="Tickets by label" description={`Top ${data.length} by volume`}>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" horizontal={false} />
          <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            {...AXIS_PROPS}
            width={96}
            interval={0}
          />
          <Tooltip
            content={<TooltipBox />}
            cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.4 }}
          />
          <Bar
            dataKey="count"
            name="Tickets"
            fill="var(--color-chart-1)"
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/** Status distribution across the workflow — one series. */
export function StatusChart({ data }: { data: DistributionSlice[] }) {
  if (data.length === 0) {
    return (
      <ChartFrame title="Tickets by status">
        <EmptyChart />
      </ChartFrame>
    )
  }

  return (
    <ChartFrame title="Tickets by status" description="In workflow order">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis
            dataKey="name"
            {...AXIS_PROPS}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={62}
          />
          <YAxis {...AXIS_PROPS} allowDecimals={false} width={44} />
          <Tooltip
            content={<TooltipBox />}
            cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.4 }}
          />
          <Bar
            dataKey="count"
            name="Tickets"
            fill="var(--color-chart-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/**
 * Team workload — a stacked bar per person.
 *
 * Four series, so it carries a legend; segments are separated by a 2px surface
 * gap so adjacent fills never blend into one block.
 */
export function WorkloadChart({ data }: { data: WorkloadRow[] }) {
  if (data.length === 0) {
    return (
      <ChartFrame title="Team workload">
        <EmptyChart message="No tickets are assigned yet." />
      </ChartFrame>
    )
  }

  return (
    <ChartFrame
      title="Team workload"
      description="Assigned tickets by status"
    >
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" horizontal={false} />
          <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            {...AXIS_PROPS}
            width={110}
            interval={0}
          />
          <Tooltip
            content={<TooltipBox />}
            cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.4 }}
          />
          <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ fontSize: 11 }} />

          <Bar dataKey="open" name="Open" stackId="w" fill="var(--color-chart-1)" maxBarSize={22} />
          <Bar dataKey="inProgress" name="In progress" stackId="w" fill="var(--color-chart-2)" maxBarSize={22} />
          <Bar dataKey="blocked" name="Blocked" stackId="w" fill="var(--color-chart-5)" maxBarSize={22} />
          <Bar
            dataKey="done"
            name="Done"
            stackId="w"
            fill="var(--color-chart-3)"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function EmptyChart({ message = 'Not enough data yet.' }: { message?: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}
