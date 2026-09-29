/**
 * Time tracking arithmetic: reading "1h 30m", printing minutes, and weeks.
 *
 * Pure, so the parser — which people will type anything into — is pinned by
 * the domain suite.
 */

/** Longest single entry accepted: a day. Anything longer is a typo. */
export const MAX_ENTRY_MINUTES = 24 * 60

/**
 * Minutes from what a person types, or null when it cannot be read.
 *
 * Accepts `90`, `90m`, `1h`, `1.5h`, `1,5h`, `1h 30m`, `1h30`, `1:30`, `2d`
 * (a working day is eight hours). A bare number is minutes, because "15" in a
 * time box almost always means a quarter of an hour.
 */
export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/,/g, '.')
  if (!text) return null

  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text)
  if (clock) return finish(Number(clock[1]) * 60 + Number(clock[2]))

  if (/^\d+$/.test(text)) return finish(Number(text))

  const pattern = /(\d+(?:\.\d+)?)\s*(d|h|m)?/g
  let total = 0
  let matched = ''
  let lastUnit: string | undefined
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1])
    const unit = match[2] ?? (lastUnit === 'h' ? 'm' : undefined)
    if (!unit) return null
    total += unit === 'd' ? value * 8 * 60 : unit === 'h' ? value * 60 : value
    matched += match[0]
    lastUnit = unit
  }
  // Everything typed must have been understood: "1h and a bit" is refused.
  if (matched.replace(/\s/g, '') !== text.replace(/\s/g, '')) return null
  return finish(total)
}

function finish(minutes: number): number | null {
  const rounded = Math.round(minutes)
  return rounded > 0 && rounded <= MAX_ENTRY_MINUTES ? rounded : null
}

/** "1h 30m", "45m", "8h". */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Decimal hours for reports: 90 → "1.5". */
export function decimalHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toString()
}

/** A stopped timer's minutes: at least one, so a started timer always counts. */
export function timerMinutes(startedAt: Date, endedAt: Date): number {
  return Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000))
}

/** Monday 00:00 UTC of the week containing `date`, and the seven days from it. */
export function weekOf(date: Date): { start: Date; days: Date[]; end: Date } {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const offset = (day.getUTCDay() + 6) % 7
  const start = new Date(day.getTime() - offset * 86_400_000)
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 86_400_000))
  return { start, days, end: new Date(start.getTime() + 7 * 86_400_000) }
}

/** Amount billed for minutes at an hourly rate, to the cent. */
export function billedAmount(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate * 100) / 100
}
