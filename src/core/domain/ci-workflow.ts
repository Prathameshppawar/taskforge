import { parse } from 'yaml'

/**
 * Rules for a GitHub Actions workflow written by a model.
 *
 * A workflow is not code waiting for review: GitHub runs it. One pushed on a
 * branch of the same repository runs on `pull_request` the moment the pull
 * request opens — with the repository's secrets — before anybody has read it.
 * And the ticket that asked for it is text anyone on the project can write.
 *
 * So a model-written workflow must be harmless to *run*, not just plausible to
 * read. Every rule here closes a way for it to reach something it should not:
 *
 *   - no `pull_request_target` / `workflow_run`: the triggers that run with
 *     secrets and write access against code nobody has reviewed;
 *   - no secret but `GITHUB_TOKEN`, and no `secrets: inherit` — a job that
 *     needs a deploy key says so in the pull request instead;
 *   - no `write-all` permissions;
 *   - third-party actions pinned to a full commit sha, because a tag is a
 *     pointer its owner can move after review. GitHub's own `actions/*` and
 *     `github/*` may use tags.
 *
 * Parsed, not grepped: a regex over the text would miss `secrets['X']` and
 * trip over a comment that merely mentions a secret.
 */

export interface WorkflowCheck {
  ok: boolean
  problems: string[]
}

const FORBIDDEN_TRIGGERS = new Set(['pull_request_target', 'workflow_run'])
const TRUSTED_OWNERS = new Set(['actions', 'github'])
const MAX_BYTES = 40_000

export function isWorkflowPath(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)
}

export function checkWorkflow(source: string): WorkflowCheck {
  const problems: string[] = []
  if (source.length > MAX_BYTES) return { ok: false, problems: ['The workflow is too large.'] }

  let doc: unknown
  try {
    doc = parse(source)
  } catch (error) {
    return { ok: false, problems: [`It is not valid YAML: ${(error as Error).message.split('\n')[0]}`] }
  }
  if (!isRecord(doc)) return { ok: false, problems: ['A workflow must be a YAML mapping.'] }

  // `on` — YAML 1.1 parsers read a bare `on` as boolean true; accept both.
  const on = doc.on ?? (doc as Record<string, unknown>)['true']
  if (on === undefined) problems.push('It has no `on:` trigger.')
  for (const trigger of triggerNames(on)) {
    if (FORBIDDEN_TRIGGERS.has(trigger)) {
      problems.push(`\`${trigger}\` is not allowed: it runs with secrets against unreviewed code.`)
    }
  }

  if (!isRecord(doc.jobs) || Object.keys(doc.jobs).length === 0) problems.push('It has no jobs.')

  walk(doc, (value, path) => {
    if (typeof value === 'string') {
      for (const expression of value.match(/\$\{\{[\s\S]*?\}\}/g) ?? []) {
        const usesSecrets = /\bsecrets\b/.test(expression)
        const onlyToken = expression.replace(/\bsecrets\.GITHUB_TOKEN\b/g, '').match(/\bsecrets\b/) === null
        if (usesSecrets && !onlyToken) {
          problems.push(`${path}: only \`secrets.GITHUB_TOKEN\` may be used. Name any other secret in the pull request description instead.`)
        }
      }
    }

    const key = path.split('.').pop()
    if (key === 'secrets' && value === 'inherit') {
      problems.push(`${path}: \`secrets: inherit\` passes every secret along and is not allowed.`)
    }
    if (key === 'permissions' && value === 'write-all') {
      problems.push(`${path}: \`write-all\` is not allowed. Grant the specific permissions the job needs.`)
    }
    if (key === 'uses' && typeof value === 'string') {
      const problem = checkUses(value)
      if (problem) problems.push(`${path}: ${problem}`)
    }
  })

  return { ok: problems.length === 0, problems: [...new Set(problems)] }
}

function checkUses(ref: string): string | null {
  if (ref.startsWith('./')) return null
  if (ref.startsWith('docker://')) {
    return ref.includes('@sha256:') ? null : `\`${ref}\` must be pinned by digest (@sha256:…).`
  }
  const match = /^([^/@\s]+)\/[^@\s]+@(.+)$/.exec(ref)
  if (!match) return `\`${ref}\` is not a valid action reference.`
  const [, owner, version] = match
  if (TRUSTED_OWNERS.has(owner.toLowerCase())) return null
  return /^[0-9a-f]{40}$/.test(version)
    ? null
    : `\`${ref}\` is a third-party action; pin it to a full commit sha, not a tag or branch.`
}

function triggerNames(on: unknown): string[] {
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.filter((entry): entry is string => typeof entry === 'string')
  if (isRecord(on)) return Object.keys(on)
  return []
}

function walk(value: unknown, visit: (value: unknown, path: string) => void, path = '') {
  visit(value, path || '(root)')
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, `${path}[${index}]`))
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) walk(entry, visit, path ? `${path}.${key}` : key)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
