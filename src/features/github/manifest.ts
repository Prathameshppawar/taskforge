/**
 * The GitHub App manifest: everything GitHub needs to create the app for us.
 *
 * Posting this to GitHub's "new app" page pre-fills the form. The person
 * confirms (and may rename it — app names are unique across all of GitHub),
 * GitHub creates the app and redirects back with a one-time code, and the code
 * is exchanged for the app's id, private key and webhook secret. Nobody copies
 * a key out of a browser, and nothing has to be pasted into an env file.
 */

/**
 * Write access to contents and pull requests is what lets "Fix with AI" push a
 * branch and open a pull request. Nothing else writes: status automation only
 * reads, and no code path merges or pushes to a default branch. `workflows` is
 * deliberately absent, so even a compromised run cannot change CI.
 */
export const APP_PERMISSIONS = {
  metadata: 'read',
  contents: 'write',
  pull_requests: 'write',
  checks: 'read',
} as const

/**
 * `installation` and `installation_repositories` are delivered to every app
 * without being asked for, so they are not listed.
 */
export const APP_EVENTS = [
  'create',
  'delete',
  'push',
  'pull_request',
  'check_suite',
  'repository',
] as const

/** Placeholder for a webhook with nowhere public to go yet. */
export const NO_WEBHOOK_URL = 'https://example.invalid/webhook-disabled'

export function isPublicUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol !== 'https:') return false
    return !(
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.invalid')
    )
  } catch {
    return false
  }
}

/**
 * The webhook URL to register: an explicit override (a tunnel in development),
 * else this deployment's own address when GitHub can reach it, else nothing.
 */
export function resolveWebhookUrl(origin: string): string | null {
  const override = process.env.GITHUB_WEBHOOK_URL
  if (override) return override
  const own = `${origin}/api/github/webhook`
  return isPublicUrl(own) ? own : null
}

export function buildManifest(origin: string, name: string) {
  const webhookUrl = resolveWebhookUrl(origin)

  return {
    name,
    url: origin,
    description: 'Links branches, pull requests and CI to TaskForge tickets.',
    // Always active. GitHub offers no API to switch a disabled webhook on, but
    // it does offer one to change the URL — so an app created without a public
    // address starts pointed at a placeholder and is re-pointed later from the
    // integrations page.
    hook_attributes: { url: webhookUrl ?? NO_WEBHOOK_URL, active: true },
    redirect_url: `${origin}/api/github/manifest/callback`,
    setup_url: `${origin}/api/github/setup`,
    setup_on_update: true,
    // Private: only the owning account can install it. An organisation that
    // wants it creates its own from its own TaskForge, or makes it public.
    public: false,
    default_permissions: APP_PERMISSIONS,
    default_events: APP_EVENTS,
  }
}

/** Where to post the manifest: a personal account, or an organisation. */
export function manifestTarget(organization: string | null, state: string): string {
  const base = organization
    ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : 'https://github.com/settings/apps/new'
  return `${base}?state=${encodeURIComponent(state)}`
}
