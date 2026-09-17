import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Deterministic initials for avatar fallbacks. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Uppercase, alphanumeric project code derived from a free-text name. */
export function slugifyCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 10)
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Stable colour token from an arbitrary string — used for generated avatars. */
const AVATAR_COLORS = [
  'slate', 'red', 'orange', 'amber', 'lime', 'emerald',
  'teal', 'cyan', 'blue', 'indigo', 'violet', 'fuchsia', 'pink', 'rose',
] as const

export function pickAvatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function isOverdue(dueDate: Date | null | undefined, isDone: boolean): boolean {
  if (!dueDate || isDone) return false
  return dueDate.getTime() < Date.now()
}

/** Midpoint ordering key for drag-and-drop inserts without reindexing siblings. */
export function calculatePosition(before?: number | null, after?: number | null): number {
  if (before == null && after == null) return 1000
  if (before == null) return (after as number) - 1000
  if (after == null) return (before as number) + 1000
  return (before + after) / 2
}
