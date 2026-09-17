import type { RecurrenceFrequency } from '@prisma/client'

/**
 * Pure date arithmetic for recurring tickets. Kept free of I/O so the schedule
 * can be unit-tested and previewed in the UI before it is saved.
 */

function clampDayOfMonth(year: number, monthIndex: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, lastDay)
}

function addMonthsClamped(date: Date, months: number, dayOfMonth?: number | null): Date {
  const target = new Date(date)
  const desiredDay = dayOfMonth ?? target.getUTCDate()
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + months)
  target.setUTCDate(clampDayOfMonth(target.getUTCFullYear(), target.getUTCMonth(), desiredDay))
  return target
}

function alignToDayOfWeek(date: Date, dayOfWeek: number): Date {
  const result = new Date(date)
  const diff = (dayOfWeek - result.getUTCDay() + 7) % 7
  result.setUTCDate(result.getUTCDate() + diff)
  return result
}

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval: number
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  startDate: Date
  endDate?: Date | null
}

/**
 * Returns the next occurrence strictly after `after`, or null once the rule has
 * passed its end date.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date | null {
  const { frequency, dayOfWeek, dayOfMonth, startDate, endDate } = rule
  const interval = Math.max(1, rule.interval)

  let cursor = new Date(Math.max(startDate.getTime(), after.getTime()))

  switch (frequency) {
    case 'DAILY':
      cursor.setUTCDate(cursor.getUTCDate() + interval)
      break

    case 'WEEKLY':
    case 'BIWEEKLY': {
      const weeks = frequency === 'BIWEEKLY' ? interval * 2 : interval
      cursor.setUTCDate(cursor.getUTCDate() + weeks * 7)
      if (dayOfWeek != null) cursor = alignToDayOfWeek(cursor, dayOfWeek)
      break
    }

    case 'MONTHLY':
      cursor = addMonthsClamped(cursor, interval, dayOfMonth)
      break

    case 'QUARTERLY':
      cursor = addMonthsClamped(cursor, interval * 3, dayOfMonth)
      break

    case 'YEARLY':
      cursor = addMonthsClamped(cursor, interval * 12, dayOfMonth)
      break
  }

  if (endDate && cursor.getTime() > endDate.getTime()) return null
  return cursor
}

/**
 * First run for a newly created rule: the start date itself, aligned to the
 * configured weekday / day-of-month.
 */
export function firstOccurrence(rule: RecurrenceRule): Date {
  const { frequency, dayOfWeek, dayOfMonth, startDate } = rule
  let cursor = new Date(startDate)

  if ((frequency === 'WEEKLY' || frequency === 'BIWEEKLY') && dayOfWeek != null) {
    cursor = alignToDayOfWeek(cursor, dayOfWeek)
  }

  if (
    (frequency === 'MONTHLY' || frequency === 'QUARTERLY' || frequency === 'YEARLY') &&
    dayOfMonth != null
  ) {
    cursor.setUTCDate(clampDayOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), dayOfMonth))
    if (cursor.getTime() < startDate.getTime()) {
      cursor = addMonthsClamped(cursor, frequency === 'YEARLY' ? 12 : frequency === 'QUARTERLY' ? 3 : 1, dayOfMonth)
    }
  }

  return cursor
}

/** Generates up to `count` upcoming dates — used for the schedule preview. */
export function previewSchedule(rule: RecurrenceRule, count = 5): Date[] {
  const dates: Date[] = []
  let cursor = firstOccurrence(rule)

  if (!rule.endDate || cursor.getTime() <= rule.endDate.getTime()) {
    dates.push(new Date(cursor))
  }

  while (dates.length < count) {
    const next = nextOccurrence(rule, cursor)
    if (!next) break
    dates.push(new Date(next))
    cursor = next
  }

  return dates
}

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
}

export const WEEKDAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const
