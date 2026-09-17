import type { StatusCategory } from '@prisma/client'

/**
 * Workspace defaults.
 *
 * These are the values the seeder writes into the built-in project templates.
 * They are NOT hardcoded into project creation — a project always takes its
 * configuration from a template, and an admin may edit both the templates and
 * each project's configuration afterwards.
 */

export interface StatusSeed {
  name: string
  category: StatusCategory
  color: string
  position: number
  isInitial?: boolean
}

export const DEFAULT_STATUSES: StatusSeed[] = [
  { name: 'Backlog', category: 'BACKLOG', color: 'slate', position: 0 },
  { name: 'Open', category: 'TODO', color: 'blue', position: 1, isInitial: true },
  { name: 'In Progress', category: 'IN_PROGRESS', color: 'amber', position: 2 },
  { name: 'Blocked', category: 'BLOCKED', color: 'red', position: 3 },
  { name: 'Ready For Review', category: 'REVIEW', color: 'violet', position: 4 },
  { name: 'In Review', category: 'REVIEW', color: 'violet', position: 5 },
  { name: 'Testing', category: 'REVIEW', color: 'cyan', position: 6 },
  { name: 'UAT', category: 'REVIEW', color: 'teal', position: 7 },
  { name: 'Done', category: 'DONE', color: 'emerald', position: 8 },
  { name: 'Closed', category: 'DONE', color: 'green', position: 9 },
  { name: 'Cancelled', category: 'CANCELLED', color: 'zinc', position: 10 },
]

export interface PrioritySeed {
  name: string
  color: string
  level: number
  isDefault?: boolean
}

export const DEFAULT_PRIORITIES: PrioritySeed[] = [
  { name: 'Low', color: 'slate', level: 1 },
  { name: 'Medium', color: 'blue', level: 2, isDefault: true },
  { name: 'High', color: 'amber', level: 3 },
  { name: 'Critical', color: 'orange', level: 4 },
  { name: 'Blocker', color: 'red', level: 5 },
]

export interface TicketTypeSeed {
  name: string
  color: string
  icon: string
  position: number
  isDefault?: boolean
}

export const DEFAULT_TICKET_TYPES: TicketTypeSeed[] = [
  { name: 'Task', color: 'blue', icon: 'circle-check', position: 0, isDefault: true },
  { name: 'Bug', color: 'red', icon: 'bug', position: 1 },
  { name: 'Story', color: 'emerald', icon: 'bookmark', position: 2 },
  { name: 'Improvement', color: 'violet', icon: 'trending-up', position: 3 },
  { name: 'Research', color: 'cyan', icon: 'microscope', position: 4 },
  { name: 'Hotfix', color: 'orange', icon: 'flame', position: 5 },
]

export interface LabelSeed {
  name: string
  color: string
  description?: string
}

export const DEFAULT_LABELS: LabelSeed[] = [
  { name: 'Frontend-1', color: 'blue', description: 'Primary frontend workstream' },
  { name: 'Frontend-2', color: 'cyan', description: 'Secondary frontend workstream' },
  { name: 'Backend-1', color: 'emerald', description: 'Primary backend workstream' },
  { name: 'Backend-2', color: 'teal', description: 'Secondary backend workstream' },
  { name: 'Database', color: 'amber', description: 'Schema, migrations and queries' },
  { name: 'Testing', color: 'violet', description: 'QA and automated tests' },
  { name: 'DevOps', color: 'orange', description: 'CI/CD, infrastructure and releases' },
  { name: 'Security', color: 'red', description: 'Security review and hardening' },
]

/** Colour tokens offered in every colour picker (labels, statuses, priorities). */
export const COLOR_TOKENS = [
  'slate', 'zinc', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink', 'rose',
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]

/**
 * Tailwind classes per colour token.
 *
 * Written out in full rather than interpolated (`bg-${color}-500`) because
 * Tailwind scans source statically — dynamic class names would be purged.
 */
export const COLOR_CLASSES: Record<string, { dot: string; badge: string; bar: string }> = {
  slate:   { dot: 'bg-slate-500',   badge: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',       bar: 'bg-slate-500' },
  zinc:    { dot: 'bg-zinc-500',    badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',           bar: 'bg-zinc-500' },
  red:     { dot: 'bg-red-500',     badge: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',               bar: 'bg-red-500' },
  orange:  { dot: 'bg-orange-500',  badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',   bar: 'bg-orange-500' },
  amber:   { dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',       bar: 'bg-amber-500' },
  yellow:  { dot: 'bg-yellow-500',  badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-400',   bar: 'bg-yellow-500' },
  lime:    { dot: 'bg-lime-500',    badge: 'bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-400',           bar: 'bg-lime-500' },
  green:   { dot: 'bg-green-500',   badge: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',       bar: 'bg-green-500' },
  emerald: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400', bar: 'bg-emerald-500' },
  teal:    { dot: 'bg-teal-500',    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400',           bar: 'bg-teal-500' },
  cyan:    { dot: 'bg-cyan-500',    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400',           bar: 'bg-cyan-500' },
  sky:     { dot: 'bg-sky-500',     badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',               bar: 'bg-sky-500' },
  blue:    { dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',           bar: 'bg-blue-500' },
  indigo:  { dot: 'bg-indigo-500',  badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',   bar: 'bg-indigo-500' },
  violet:  { dot: 'bg-violet-500',  badge: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',   bar: 'bg-violet-500' },
  purple:  { dot: 'bg-purple-500',  badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',   bar: 'bg-purple-500' },
  fuchsia: { dot: 'bg-fuchsia-500', badge: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-400', bar: 'bg-fuchsia-500' },
  pink:    { dot: 'bg-pink-500',    badge: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400',           bar: 'bg-pink-500' },
  rose:    { dot: 'bg-rose-500',    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',           bar: 'bg-rose-500' },
}

export function colorClasses(token: string) {
  return COLOR_CLASSES[token] ?? COLOR_CLASSES.slate
}
