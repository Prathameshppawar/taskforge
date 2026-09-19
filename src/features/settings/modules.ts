import type { Permission } from '@/core/domain/rbac'

/**
 * The settings area, as modules.
 *
 * One list, used by both the navigation and the layout, so a module cannot
 * appear in one and not the other. Account modules are everyone's; workspace
 * modules each name the permission that reveals them, which is why a custom
 * role sees exactly the administration it was granted and nothing else — the
 * navigation never mentions a role by name.
 */

export interface SettingsModule {
  href: string
  label: string
  description: string
  icon: string
  /** Any one of these reveals the module. Omitted = everyone. */
  anyOf?: Permission[]
}

export interface SettingsSection {
  label: string
  modules: SettingsModule[]
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
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
  {
    label: 'Workspace',
    modules: [
      {
        href: '/settings/people',
        label: 'People',
        description: 'Accounts, roles and access. There is no self sign-up.',
        icon: 'users',
        anyOf: ['user:view'],
      },
      {
        href: '/settings/roles',
        label: 'Roles',
        description: 'What each role may do, and how they rank.',
        icon: 'shield',
        anyOf: ['role:manage'],
      },
      {
        href: '/settings/teams',
        label: 'Teams',
        description: 'Groups of people, and who may administer them.',
        icon: 'usersRound',
        anyOf: ['team:manage', 'team:manage-members'],
      },
      {
        href: '/settings/templates',
        label: 'Templates',
        description: 'The starting boards new projects are cloned from.',
        icon: 'template',
        anyOf: ['template:manage'],
      },
      {
        href: '/settings/sessions',
        label: 'Sessions',
        description: 'Who is signed in, and revoking access.',
        icon: 'monitor',
        anyOf: ['user:view'],
      },
    ],
  },
]

/** The sections this actor can actually see, with empty ones dropped. */
export function visibleSections(permissions: readonly string[]): SettingsSection[] {
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    modules: section.modules.filter(
      (module) => !module.anyOf || module.anyOf.some((p) => permissions.includes(p)),
    ),
  })).filter((section) => section.modules.length > 0)
}
