/**
 * The views a project can open on. Opening a project (sidebar, project card,
 * command palette, a ticket's breadcrumb) goes to `/projects/<id>`, which
 * redirects to the project's chosen view.
 *
 * Only views every member can read. Settings, Members and Labels are places
 * you go to change something, not somewhere to land.
 */
export const LANDING_VIEWS = [
  { segment: 'insights', label: 'Insights' },
  { segment: 'board', label: 'Board' },
  { segment: 'plan', label: 'Plan' },
  { segment: 'table', label: 'Table' },
  { segment: 'tree', label: 'Tree' },
  { segment: 'calendar', label: 'Calendar' },
  { segment: 'timeline', label: 'Timeline' },
  { segment: 'handbook', label: 'Handbook' },
  { segment: 'activity', label: 'Activity' },
] as const

export type LandingView = (typeof LANDING_VIEWS)[number]['segment']

export const DEFAULT_LANDING_VIEW: LandingView = 'insights'

export const LANDING_VIEW_SEGMENTS = LANDING_VIEWS.map((view) => view.segment) as [
  LandingView,
  ...LandingView[],
]

/** A stored value that is no longer a landing view falls back to the default. */
export function landingView(value: string | null | undefined): LandingView {
  return LANDING_VIEW_SEGMENTS.includes(value as LandingView) ? (value as LandingView) : DEFAULT_LANDING_VIEW
}
