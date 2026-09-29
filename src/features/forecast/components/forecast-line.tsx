import { format } from 'date-fns'
import { TrendingUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { daysFromNow } from '@/core/domain/forecast'
import type { CycleForecast } from '../queries'

/**
 * "85% likely by 17 Oct · 50% by 12 Oct" — and the chance of the due date, in
 * a colour that says whether to worry. Explains itself when it cannot say.
 */
export function ForecastLine({ forecast, dueDate, className }: { forecast: CycleForecast | null; dueDate: Date | null; className?: string }) {
  if (!forecast) return null
  if (!forecast.ok) {
    return (
      <p className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <TrendingUp className="size-3.5" aria-hidden /> Forecast {forecast.reason}.
      </p>
    )
  }
  const { p50, p85, onTime } = forecast.forecast
  const now = new Date()
  if (forecast.remaining === 0) {
    return <p className={cn('flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400', className)}>All the planned work is done.</p>
  }
  const tone = onTime === null ? 'text-foreground' : onTime >= 0.85 ? 'text-emerald-600 dark:text-emerald-400' : onTime >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'
  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs', className)} title={`From ${forecast.forecast.runs} simulations over the last ${forecast.forecast.basis.days} days (${forecast.forecast.basis.completed} ${forecast.unit} finished)`}>
      <TrendingUp className="size-3.5 text-muted-foreground" aria-hidden />
      <span>
        <strong>85%</strong> likely by <strong>{format(daysFromNow(p85, now), 'd MMM')}</strong>
      </span>
      <span className="text-muted-foreground">· 50% by {format(daysFromNow(p50, now), 'd MMM')}</span>
      {onTime !== null && dueDate && (
        <span className={cn('font-medium', tone)}>
          · {Math.round(onTime * 100)}% chance of {format(dueDate, 'd MMM')}
        </span>
      )}
      <span className="text-muted-foreground">
        · {forecast.remaining} {forecast.unit} left
      </span>
    </p>
  )
}
