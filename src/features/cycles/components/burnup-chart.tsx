'use client'

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format, parseISO } from 'date-fns'

import type { BurnupPoint } from '@/core/domain/cycles'

/**
 * Burn-up: scope as a stepped line, done as a filled area beneath it, and the
 * straight line a steady pace would have drawn. A burn-up rather than a
 * burn-down, because scope that grows mid-sprint is visible as the top line
 * rising — a burn-down hides it inside a flatter slope.
 */
export function BurnupChart({
  series,
  unit,
  ideal,
}: {
  series: BurnupPoint[]
  unit: 'points' | 'tickets'
  /** The pace line: 0 at the first day to this much at `ideal.day`. */
  ideal: { day: string; value: number } | null
}) {
  const first = series[0]?.day
  // Lines need two points; the first days of a cycle need dots to be seen.
  const dots = series.length < 4 ? { r: 3 } : false
  const data = series.map((point, index) => {
    let pace: number | undefined
    if (ideal && first) {
      const total = (parseISO(ideal.day).getTime() - parseISO(first).getTime()) / 86_400_000
      pace = total > 0 ? Math.min(ideal.value, (ideal.value * index) / total) : ideal.value
    }
    return { ...point, pace }
  })
  if (ideal && first && data.length && data[data.length - 1].day < ideal.day) {
    data.push({ day: ideal.day, scope: undefined as never, done: undefined as never, pace: ideal.value })
  }

  return (
    <div className="h-72 w-full" role="img" aria-label={`Burn-up in ${unit}: ${series.at(-1)?.done ?? 0} done of ${series.at(-1)?.scope ?? 0}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(day: string) => format(parseISO(day), 'd MMM')}
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as { scope?: number; done?: number; pace?: number }
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <p className="font-medium">{format(parseISO(String(label)), 'EEE d MMM')}</p>
                  {row.scope !== undefined && <p>Scope: {row.scope} {unit}</p>}
                  {row.done !== undefined && <p>Done: {row.done} {unit}</p>}
                  {row.pace !== undefined && <p className="text-muted-foreground">Steady pace: {Math.round(row.pace * 10) / 10}</p>}
                </div>
              )
            }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="stepAfter"
            dataKey="done"
            name="Done"
            stroke="var(--chart-3)"
            strokeWidth={2}
            fill="var(--chart-3)"
            fillOpacity={0.18}
            isAnimationActive={false}
            connectNulls={false}
            dot={dots ? { ...dots, fill: 'var(--chart-3)', stroke: 'var(--card)' } : false}
          />
          <Line
            type="stepAfter"
            dataKey="scope"
            name="Scope"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={dots ? { ...dots, fill: 'var(--chart-1)', stroke: 'var(--card)' } : false}
            isAnimationActive={false}
            connectNulls={false}
          />
          {ideal && (
            <Line
              type="linear"
              dataKey="pace"
              name="Steady pace"
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
