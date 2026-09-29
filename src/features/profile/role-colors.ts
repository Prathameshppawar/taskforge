/**
 * The rim drawn around a person's avatar, coloured by their workspace role, so
 * a project manager or a client reads as one wherever their face appears.
 *
 * `Role.color` holds the administrator's choice. Null means "never chosen" and
 * falls back to the default below, which is how a built-in role created after
 * the migration (the AI agent role is created on first use) still gets its
 * rim. An empty string is an explicit "no rim".
 */

export const DEFAULT_ROLE_COLORS: Readonly<Record<string, string>> = {
  ADMIN: 'violet',
  PROJECT_MANAGER: 'blue',
  USER: 'green',
  CLIENT: 'amber',
  AI_AGENT: 'fuchsia',
}

export function roleRimColor(role: { key: string; color: string | null }): string | null {
  if (role.color === null) return DEFAULT_ROLE_COLORS[role.key] ?? null
  return role.color || null
}

/**
 * Ring classes per colour token, written out in full because Tailwind scans the
 * source for class names and would drop an interpolated `ring-${color}-500`.
 */
export const RING_CLASSES: Readonly<Record<string, string>> = {
  slate: 'ring-slate-500',
  zinc: 'ring-zinc-500',
  red: 'ring-red-500',
  orange: 'ring-orange-500',
  amber: 'ring-amber-500',
  yellow: 'ring-yellow-500',
  lime: 'ring-lime-500',
  green: 'ring-green-500',
  emerald: 'ring-emerald-500',
  teal: 'ring-teal-500',
  cyan: 'ring-cyan-500',
  sky: 'ring-sky-500',
  blue: 'ring-blue-500',
  indigo: 'ring-indigo-500',
  violet: 'ring-violet-500',
  purple: 'ring-purple-500',
  fuchsia: 'ring-fuchsia-500',
  pink: 'ring-pink-500',
  rose: 'ring-rose-500',
}
