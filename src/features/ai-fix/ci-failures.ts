import { asInstallation } from '@/infrastructure/github/client'

/**
 * What failed on a commit, as text a model can act on.
 *
 * Three sources, most specific first: a check's annotations (file and line),
 * its summary, and — for GitHub Actions — the tail of the job's log, which is
 * where the actual error message almost always is. Logs need the app's
 * `actions: read`; without it the annotations and summaries are still used.
 *
 * All of it is untrusted: a log prints whatever the code under test printed,
 * which can include text written to look like instructions.
 */

interface CheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  details_url?: string | null
  app?: { slug?: string } | null
  output?: { title?: string | null; summary?: string | null; text?: string | null } | null
}

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])
const LOG_TAIL_LINES = 120
const MAX_CHARS = 14_000

export async function describeFailures(installationId: bigint, fullName: string, sha: string): Promise<string | null> {
  const runs = await asInstallation<{ check_runs: CheckRun[] }>(
    installationId,
    `/repos/${fullName}/commits/${sha}/check-runs?per_page=50`,
  )
  const failed = runs.check_runs.filter((run) => run.status === 'completed' && FAILED.has(run.conclusion ?? ''))
  if (failed.length === 0) return null

  const sections: string[] = []
  for (const run of failed.slice(0, 5)) {
    const lines = [`### ${run.name} — ${run.conclusion}`]
    if (run.output?.title) lines.push(run.output.title)
    if (run.output?.summary) lines.push(run.output.summary.slice(0, 1500))

    const annotations = await asInstallation<Array<{ path: string; start_line: number; annotation_level: string; message: string }>>(
      installationId,
      `/repos/${fullName}/check-runs/${run.id}/annotations?per_page=30`,
    ).catch(() => [])
    for (const note of annotations) {
      lines.push(`${note.path}:${note.start_line} [${note.annotation_level}] ${note.message}`)
    }

    const jobId = /\/job\/(\d+)/.exec(run.details_url ?? '')?.[1]
    if (jobId && run.app?.slug === 'github-actions') {
      const log = await jobLogTail(installationId, fullName, jobId)
      if (log) lines.push('Log (last lines):', log)
    }
    sections.push(lines.join('\n'))
  }

  const text = sections.join('\n\n')
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… (truncated)` : text
}

/**
 * The end of a job's log. GitHub answers the logs endpoint with a redirect to
 * a short-lived download URL, which `fetch` follows; the timestamp prefix on
 * every line is stripped because it is noise to a model.
 */
async function jobLogTail(installationId: bigint, fullName: string, jobId: string): Promise<string | null> {
  try {
    const { installationToken } = await import('@/infrastructure/github/client')
    const token = await installationToken(installationId)
    const response = await fetch(`https://api.github.com/repos/${fullName}/actions/jobs/${jobId}/logs`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TaskForge' },
      redirect: 'follow',
      cache: 'no-store',
    })
    if (!response.ok) return null
    const lines = (await response.text())
      .split('\n')
      .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
      .filter((line) => line.trim() !== '')
    return lines.slice(-LOG_TAIL_LINES).join('\n')
  } catch {
    return null
  }
}
