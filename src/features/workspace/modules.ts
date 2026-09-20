import type { NavSection } from '@/features/settings/modules'

/**
 * Workspace administration.
 *
 * A top-level area rather than a drawer inside Settings. Running the place —
 * who is here, what they may do, which teams they sit in — is recurring work
 * for the people who do it, and recurring work belongs in the sidebar next to
 * the other recurring work, not behind a gear icon.
 *
 * Every module is permission-gated, so the sidebar entry is simply absent for
 * someone who administers nothing. The section label is kept because the shell
 * renders a grouped navigation and an ungrouped list would need a second code
 * path for no benefit.
 */
export const WORKSPACE_SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    modules: [
      {
        href: '/workspace/people',
        label: 'People',
        description: 'Accounts, roles and access. There is no self sign-up.',
        icon: 'users',
        anyOf: ['user:view'],
      },
      {
        href: '/workspace/roles',
        label: 'Roles',
        description: 'What each role may do, and how they rank.',
        icon: 'shield',
        anyOf: ['role:manage'],
      },
      {
        href: '/workspace/teams',
        label: 'Teams',
        description: 'Groups of people, and who may administer them.',
        icon: 'usersRound',
        anyOf: ['team:manage', 'team:manage-members'],
      },
      {
        href: '/workspace/templates',
        label: 'Templates',
        description: 'The starting boards new projects are cloned from.',
        icon: 'template',
        anyOf: ['template:manage'],
      },
      {
        href: '/workspace/sessions',
        label: 'Sessions',
        description: 'Who is signed in, and revoking access.',
        icon: 'monitor',
        anyOf: ['user:view'],
      },
    ],
  },
]

/**
 * Every permission that reveals at least one workspace module.
 *
 * The sidebar uses this to decide whether to show the Workspace entry at all,
 * so the test stays derived from the module list rather than a second hand-kept
 * copy that could drift when a module is added.
 */
export const WORKSPACE_PERMISSIONS = [
  ...new Set(WORKSPACE_SECTIONS.flatMap((s) => s.modules.flatMap((m) => m.anyOf ?? []))),
]
