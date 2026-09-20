import type { Permission } from '@/core/domain/rbac'

/**
 * Navigable module lists, shared by a shell's navigation and its layout.
 *
 * One list per area, used by both, so a module cannot appear in the navigation
 * and not the shell. Modules each name the permission that reveals them, which
 * is why a custom role sees exactly the administration it was granted and
 * nothing else — the navigation never mentions a role by name.
 */

export interface NavModule {
  href: string
  label: string
  description: string
  icon: string
  /** Any one of these reveals the module. Omitted = everyone. */
  anyOf?: Permission[]
}

export interface NavSection {
  label: string
  modules: NavModule[]
}

/**
 * Settings, which is now only your own account.
 *
 * Workspace administration used to live here too. It moved out to `/workspace`
 * because the two answer different questions — "how am I set up?" versus "how
 * is this organisation set up?" — and burying People and Roles two levels deep
 * under a gear icon made the work of running the place feel incidental.
 * See `src/features/workspace/modules.ts`.
 */
export const SETTINGS_SECTIONS: NavSection[] = [
  {
    label: 'Account',
    modules: [
      {
        href: '/settings',
        label: 'Profile',
        description: 'Your name, job title and how you appear to colleagues.',
        icon: 'user',
      },
      {
        href: '/settings/notifications',
        label: 'Notifications',
        description: 'Whether new work makes a sound.',
        icon: 'bell',
      },
      {
        href: '/settings/security',
        label: 'Security',
        description: 'Change your password.',
        icon: 'lock',
      },
      {
        href: '/settings/tokens',
        label: 'Access tokens',
        description: 'Personal tokens for scripts, CI and the MCP server.',
        icon: 'key',
      },
    ],
  },
]

/** The sections this actor can actually see, with empty ones dropped. */
export function visibleSections(
  sections: NavSection[],
  permissions: readonly string[],
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      modules: section.modules.filter(
        (module) => !module.anyOf || module.anyOf.some((p) => permissions.includes(p)),
      ),
    }))
    .filter((section) => section.modules.length > 0)
}
