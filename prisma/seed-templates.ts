import {
  DEFAULT_LABELS,
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  DEFAULT_TICKET_TYPES,
  type LabelSeed,
} from '../src/core/domain/defaults'

/**
 * Built-in project templates.
 *
 * Each carries a full workflow (statuses, priorities, types, labels) plus a
 * default ticket scaffold expressed as parent features with their child tasks.
 * Admins can edit these or author new ones from the UI.
 */

export interface TemplateTicketSeed {
  title: string
  description?: string
  typeName?: string
  priorityName?: string
  labels?: string[]
  children?: TemplateTicketSeed[]
}

export interface TemplateSeed {
  name: string
  description: string
  icon: string
  color: string
  isDefault?: boolean
  labels: LabelSeed[]
  tickets: TemplateTicketSeed[]
}

const webLabels: LabelSeed[] = DEFAULT_LABELS

const apiLabels: LabelSeed[] = [
  { name: 'Backend-1', color: 'emerald', description: 'Primary backend workstream' },
  { name: 'Backend-2', color: 'teal', description: 'Secondary backend workstream' },
  { name: 'Database', color: 'amber', description: 'Schema, migrations and queries' },
  { name: 'API Contract', color: 'blue', description: 'Endpoint and payload design' },
  { name: 'Testing', color: 'violet', description: 'QA and automated tests' },
  { name: 'DevOps', color: 'orange', description: 'CI/CD, infrastructure and releases' },
  { name: 'Security', color: 'red', description: 'Security review and hardening' },
  { name: 'Performance', color: 'cyan', description: 'Latency and throughput work' },
]

const mobileLabels: LabelSeed[] = [
  { name: 'iOS', color: 'slate', description: 'iOS-specific work' },
  { name: 'Android', color: 'green', description: 'Android-specific work' },
  { name: 'Shared', color: 'blue', description: 'Cross-platform code' },
  { name: 'UI', color: 'violet', description: 'Screens and components' },
  { name: 'Backend-1', color: 'emerald', description: 'Supporting API work' },
  { name: 'Release', color: 'orange', description: 'Store submissions and rollout' },
  { name: 'Testing', color: 'cyan', description: 'QA and device testing' },
  { name: 'Analytics', color: 'amber', description: 'Tracking and instrumentation' },
]

const maintenanceLabels: LabelSeed[] = [
  { name: 'Incident', color: 'red', description: 'Live incident response' },
  { name: 'Bugfix', color: 'orange', description: 'Defect remediation' },
  { name: 'Dependency', color: 'amber', description: 'Library and runtime upgrades' },
  { name: 'Monitoring', color: 'cyan', description: 'Alerting and observability' },
  { name: 'Security', color: 'rose', description: 'Patching and hardening' },
  { name: 'Compliance', color: 'violet', description: 'Audits and access reviews' },
  { name: 'DevOps', color: 'blue', description: 'Infrastructure upkeep' },
  { name: 'Documentation', color: 'slate', description: 'Runbooks and knowledge base' },
]

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    name: 'Full Stack Web App',
    description:
      'End-to-end web application delivery: authentication, UI, API and deployment, laid out as features with their implementation tasks.',
    icon: 'layout-dashboard',
    color: 'indigo',
    isDefault: true,
    labels: webLabels,
    tickets: [
      {
        title: 'Project Setup',
        description: 'Repository, tooling, CI and environment configuration.',
        typeName: 'Task',
        priorityName: 'High',
        labels: ['DevOps'],
        children: [
          { title: 'Initialise repository and tooling', typeName: 'Task', labels: ['DevOps'] },
          { title: 'Configure CI pipeline', typeName: 'Task', labels: ['DevOps'] },
          { title: 'Set up environments and secrets', typeName: 'Task', labels: ['DevOps', 'Security'] },
        ],
      },
      {
        title: 'Authentication Module',
        description: 'Sign-in, sign-out, password reset and session handling.',
        typeName: 'Story',
        priorityName: 'High',
        labels: ['Security'],
        children: [
          { title: 'Login API', typeName: 'Task', priorityName: 'High', labels: ['Backend-1'] },
          { title: 'Login UI', typeName: 'Task', priorityName: 'High', labels: ['Frontend-1'] },
          { title: 'Password Reset API', typeName: 'Task', labels: ['Backend-1'] },
          { title: 'Password Reset UI', typeName: 'Task', labels: ['Frontend-1'] },
          { title: 'Session management and guards', typeName: 'Task', labels: ['Backend-1', 'Security'] },
        ],
      },
      {
        title: 'Database Design',
        description: 'Schema, migrations and seed data.',
        typeName: 'Task',
        priorityName: 'High',
        labels: ['Database'],
        children: [
          { title: 'Design entity relationship model', typeName: 'Research', labels: ['Database'] },
          { title: 'Write initial migration', typeName: 'Task', labels: ['Database'] },
          { title: 'Create seed data', typeName: 'Task', labels: ['Database'] },
        ],
      },
      {
        title: 'Core UI Shell',
        description: 'Navigation, layout, theming and responsive behaviour.',
        typeName: 'Story',
        labels: ['Frontend-1'],
        children: [
          { title: 'Application layout and navigation', typeName: 'Task', labels: ['Frontend-1'] },
          { title: 'Dark and light theme', typeName: 'Task', labels: ['Frontend-2'] },
          { title: 'Responsive breakpoints', typeName: 'Task', labels: ['Frontend-2'] },
        ],
      },
      {
        title: 'Quality and Release',
        description: 'Test coverage, performance pass and production deployment.',
        typeName: 'Task',
        labels: ['Testing'],
        children: [
          { title: 'Automated test suite', typeName: 'Task', labels: ['Testing'] },
          { title: 'Accessibility review', typeName: 'Improvement', labels: ['Frontend-1'] },
          { title: 'Production deployment', typeName: 'Task', priorityName: 'High', labels: ['DevOps'] },
        ],
      },
    ],
  },

  {
    name: 'Backend API Project',
    description:
      'Service-oriented delivery: contract design, endpoints, data layer, observability and hardening.',
    icon: 'server',
    color: 'emerald',
    labels: apiLabels,
    tickets: [
      {
        title: 'API Contract',
        description: 'Endpoint surface, payload shapes and versioning policy.',
        typeName: 'Research',
        priorityName: 'High',
        labels: ['API Contract'],
        children: [
          { title: 'Define resource model', typeName: 'Research', labels: ['API Contract'] },
          { title: 'Publish OpenAPI specification', typeName: 'Task', labels: ['API Contract'] },
          { title: 'Agree versioning and deprecation policy', typeName: 'Task', labels: ['API Contract'] },
        ],
      },
      {
        title: 'Data Layer',
        description: 'Schema, migrations, repositories and query performance.',
        typeName: 'Story',
        priorityName: 'High',
        labels: ['Database'],
        children: [
          { title: 'Schema and migrations', typeName: 'Task', labels: ['Database'] },
          { title: 'Repository implementations', typeName: 'Task', labels: ['Backend-1'] },
          { title: 'Index and query tuning', typeName: 'Improvement', labels: ['Database', 'Performance'] },
        ],
      },
      {
        title: 'Authentication and Authorization',
        typeName: 'Story',
        priorityName: 'Critical',
        labels: ['Security'],
        children: [
          { title: 'Token issuance and validation', typeName: 'Task', labels: ['Backend-1', 'Security'] },
          { title: 'Role-based access control', typeName: 'Task', labels: ['Backend-1', 'Security'] },
          { title: 'Rate limiting', typeName: 'Task', labels: ['Backend-2', 'Security'] },
        ],
      },
      {
        title: 'Observability',
        description: 'Structured logging, metrics, tracing and alerting.',
        typeName: 'Task',
        labels: ['DevOps'],
        children: [
          { title: 'Structured logging', typeName: 'Task', labels: ['DevOps'] },
          { title: 'Metrics and dashboards', typeName: 'Task', labels: ['DevOps'] },
          { title: 'Alerting rules', typeName: 'Task', labels: ['DevOps'] },
        ],
      },
    ],
  },

  {
    name: 'Mobile Application',
    description:
      'Cross-platform mobile delivery: shared foundations, platform work, store release and instrumentation.',
    icon: 'smartphone',
    color: 'violet',
    labels: mobileLabels,
    tickets: [
      {
        title: 'App Foundations',
        description: 'Navigation, state management, design system and build config.',
        typeName: 'Story',
        priorityName: 'High',
        labels: ['Shared'],
        children: [
          { title: 'Navigation structure', typeName: 'Task', labels: ['Shared'] },
          { title: 'Design system and components', typeName: 'Task', labels: ['UI'] },
          { title: 'Build and signing configuration', typeName: 'Task', labels: ['Release'] },
        ],
      },
      {
        title: 'Onboarding and Authentication',
        typeName: 'Story',
        priorityName: 'High',
        labels: ['UI'],
        children: [
          { title: 'Sign-in screen', typeName: 'Task', labels: ['UI'] },
          { title: 'Biometric unlock', typeName: 'Improvement', labels: ['iOS', 'Android'] },
          { title: 'Session persistence', typeName: 'Task', labels: ['Shared'] },
        ],
      },
      {
        title: 'Offline Support',
        description: 'Local cache, sync and conflict handling.',
        typeName: 'Story',
        labels: ['Shared'],
        children: [
          { title: 'Local cache layer', typeName: 'Task', labels: ['Shared'] },
          { title: 'Background sync', typeName: 'Task', labels: ['Shared'] },
          { title: 'Conflict resolution rules', typeName: 'Research', labels: ['Shared'] },
        ],
      },
      {
        title: 'Store Release',
        typeName: 'Task',
        priorityName: 'High',
        labels: ['Release'],
        children: [
          { title: 'App Store submission', typeName: 'Task', labels: ['iOS', 'Release'] },
          { title: 'Play Store submission', typeName: 'Task', labels: ['Android', 'Release'] },
          { title: 'Crash reporting and analytics', typeName: 'Task', labels: ['Analytics'] },
        ],
      },
    ],
  },

  {
    name: 'Maintenance Project',
    description:
      'Ongoing operational work: incident response, patching, dependency upkeep and recurring compliance reviews.',
    icon: 'wrench',
    color: 'amber',
    labels: maintenanceLabels,
    tickets: [
      {
        title: 'Operational Readiness',
        description: 'Runbooks, on-call rotation and escalation paths.',
        typeName: 'Task',
        priorityName: 'High',
        labels: ['Documentation'],
        children: [
          { title: 'Write incident runbook', typeName: 'Task', labels: ['Documentation'] },
          { title: 'Define escalation matrix', typeName: 'Task', labels: ['Documentation'] },
          { title: 'Verify alert routing', typeName: 'Task', labels: ['Monitoring'] },
        ],
      },
      {
        title: 'Security and Compliance',
        typeName: 'Task',
        priorityName: 'Critical',
        labels: ['Security'],
        children: [
          { title: 'Dependency vulnerability sweep', typeName: 'Task', labels: ['Dependency', 'Security'] },
          { title: 'Quarterly access review', typeName: 'Task', labels: ['Compliance'] },
          { title: 'Backup restore drill', typeName: 'Task', labels: ['DevOps'] },
        ],
      },
      {
        title: 'Platform Upkeep',
        typeName: 'Task',
        labels: ['DevOps'],
        children: [
          { title: 'Runtime and framework upgrades', typeName: 'Improvement', labels: ['Dependency'] },
          { title: 'Cost and capacity review', typeName: 'Research', labels: ['DevOps'] },
          { title: 'Log retention tidy-up', typeName: 'Task', labels: ['Monitoring'] },
        ],
      },
    ],
  },
]

export { DEFAULT_STATUSES, DEFAULT_PRIORITIES, DEFAULT_TICKET_TYPES }
