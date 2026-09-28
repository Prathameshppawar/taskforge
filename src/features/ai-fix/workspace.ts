import { asInstallation } from '@/infrastructure/github/client'
import { applyEdit, checkRepoPath, isListable, looksBinary } from '@/core/domain/ai-fix'
import { checkWorkflow, isWorkflowPath } from '@/core/domain/ci-workflow'

/**
 * A staged, in-memory copy of one repository at one commit.
 *
 * Reads go to GitHub (and are cached); writes stay here until `commit`, which
 * turns every staged change into a single commit on a new branch through the
 * Git Data API. Nothing a model does reaches the repository until the run has
 * finished, and then only as a branch and a pull request — never the default
 * branch.
 *
 * No clone, no disk and no shell, which is what lets this run inside a
 * serverless function. The price is that nothing can be executed: the model
 * cannot run the tests, and the pull request's own CI is what checks its work.
 */

const MAX_FILE_BYTES = 120_000
const MAX_LISTED = 800

interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
  sha: string
}

export class RepoWorkspace {
  private tree: TreeEntry[] | null = null
  private readonly cache = new Map<string, string>()
  /** path → new content, or null for a deletion. */
  private readonly staged = new Map<string, string | null>()

  constructor(
    private readonly installationId: bigint,
    readonly fullName: string,
    readonly baseBranch: string,
    readonly baseSha: string,
    /** Whether workflow files may be written; see ProjectSettings.aiWorkflows. */
    readonly allowWorkflows = false,
  ) {}

  static async open(installationId: bigint, fullName: string, branch: string, options: { allowWorkflows?: boolean } = {}) {
    const ref = await asInstallation<{ object: { sha: string } }>(
      installationId,
      `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`,
    )
    return new RepoWorkspace(installationId, fullName, branch, ref.object.sha, options.allowWorkflows ?? false)
  }

  private check(raw: string) {
    const checked = checkRepoPath(raw, { allowWorkflows: this.allowWorkflows })
    if (!checked.ok) throw new WorkspaceError(checked.reason)
    return checked.path
  }

  private async entries(): Promise<TreeEntry[]> {
    if (this.tree) return this.tree
    const result = await asInstallation<{ tree: TreeEntry[]; truncated: boolean }>(
      this.installationId,
      `/repos/${this.fullName}/git/trees/${this.baseSha}?recursive=1`,
    )
    this.tree = result.tree.filter((entry) => entry.type === 'blob')
    return this.tree
  }

  /** Every file path, with staged creations and deletions applied. */
  async listFiles(prefix = ''): Promise<{ paths: string[]; truncated: boolean }> {
    const base = (await this.entries()).map((entry) => entry.path)
    const all = new Set(base)
    for (const [path, content] of this.staged) {
      if (content === null) all.delete(path)
      else all.add(path)
    }
    const normalised = prefix.replace(/^\.?\/+/, '').replace(/\/+$/, '')
    const matching = [...all]
      .filter((path) => isListable(path))
      .filter((path) => !normalised || path === normalised || path.startsWith(`${normalised}/`))
      .sort()
    return { paths: matching.slice(0, MAX_LISTED), truncated: matching.length > MAX_LISTED }
  }

  async readFile(raw: string): Promise<string> {
    const path = this.check(raw)

    if (this.staged.has(path)) {
      const content = this.staged.get(path)
      if (content === null || content === undefined) throw new WorkspaceError(`${path} has been deleted in this change.`)
      return content
    }

    const original = await this.readOriginal(path)
    if (original === null) throw new WorkspaceError(`${path} does not exist. Use list_files to see what does.`)
    return original
  }

  /** The file as it is at the base commit, ignoring staged changes; null if absent. */
  private async readOriginal(path: string): Promise<string | null> {
    if (this.cache.has(path)) return this.cache.get(path)!

    const entry = (await this.entries()).find((candidate) => candidate.path === path)
    if (!entry) return null
    if (looksBinary(path)) throw new WorkspaceError(`${path} is a binary file.`)
    if ((entry.size ?? 0) > MAX_FILE_BYTES) {
      throw new WorkspaceError(`${path} is ${entry.size} bytes, too large to read whole.`)
    }

    const blob = await asInstallation<{ content: string; encoding: string }>(
      this.installationId,
      `/repos/${this.fullName}/git/blobs/${entry.sha}`,
    )
    const content = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
    this.cache.set(path, content)
    return content
  }

  /**
   * Case-insensitive substring search across text files, for finding where
   * something lives. Bounded, and reads files through the same cache.
   */
  async search(query: string, limit = 40): Promise<string[]> {
    const needle = query.toLowerCase()
    if (needle.length < 2) throw new WorkspaceError('Search for at least two characters.')
    const { paths } = await this.listFiles()
    const hits: string[] = []
    let scanned = 0

    for (const path of paths) {
      if (looksBinary(path)) continue
      if (scanned++ >= 300) break
      let content: string
      try {
        content = await this.readFile(path)
      } catch {
        continue
      }
      const lines = content.split('\n')
      for (let index = 0; index < lines.length; index++) {
        if (lines[index].toLowerCase().includes(needle)) {
          hits.push(`${path}:${index + 1}: ${lines[index].trim().slice(0, 160)}`)
          if (hits.length >= limit) return hits
        }
      }
    }
    return hits
  }

  async writeFile(raw: string, content: string) {
    const path = this.check(raw)
    // Checked when written, so the model hears exactly what to fix while it
    // can still fix it — rather than at commit, when the run is over.
    if (isWorkflowPath(path)) {
      const result = checkWorkflow(content)
      if (!result.ok) {
        throw new WorkspaceError(`That workflow was not saved:\n- ${result.problems.join('\n- ')}`)
      }
    }
    this.staged.set(path, content)
    return path
  }

  /** True when this change adds or edits a workflow — it opens as a draft. */
  async touchesWorkflows(): Promise<boolean> {
    return (await this.changes()).some((change) => isWorkflowPath(change.path))
  }

  async editFile(raw: string, oldText: string, newText: string) {
    const current = await this.readFile(raw)
    const result = applyEdit(current, oldText, newText)
    if (!result.ok) throw new WorkspaceError(result.reason)
    return this.writeFile(raw, result.content)
  }

  async deleteFile(raw: string) {
    const checked = { path: this.check(raw) }
    const inBase = (await this.entries()).some((entry) => entry.path === checked.path)
    if (inBase) {
      this.staged.set(checked.path, null)
    } else if (this.staged.has(checked.path)) {
      // Created earlier in this run: deleting it just drops the creation.
      this.staged.delete(checked.path)
    } else {
      throw new WorkspaceError(`${checked.path} does not exist.`)
    }
    return checked.path
  }

  /** Staged paths whose content actually differs from the base commit. */
  async changes(): Promise<Array<{ path: string; content: string | null }>> {
    const out: Array<{ path: string; content: string | null }> = []
    for (const [path, content] of this.staged) {
      if (content === null) {
        out.push({ path, content })
        continue
      }
      // Binary originals throw; a text write over one is still a change.
      const original = await this.readOriginal(path).catch(() => null)
      if (original !== content) out.push({ path, content })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  /**
   * One commit containing every change. By default on a new branch cut from
   * the base; with `onto`, on top of the branch the workspace was opened from
   * (healing a pull request). Never forced: if someone pushed to that branch
   * meanwhile, GitHub refuses the update rather than losing their commit.
   */
  async commit(branch: string, message: string, options: { onto?: boolean } = {}): Promise<{ sha: string; files: string[] }> {
    const changes = await this.changes()
    if (changes.length === 0) throw new WorkspaceError('Nothing to commit.')
    // Belt and braces: every workflow is re-checked at the last moment, so no
    // path through the staging code can commit one that was never validated.
    for (const change of changes) {
      if (change.content !== null && isWorkflowPath(change.path)) {
        if (!this.allowWorkflows) throw new WorkspaceError(`${change.path}: workflows are not allowed in this project.`)
        const result = checkWorkflow(change.content)
        if (!result.ok) throw new WorkspaceError(`${change.path}: ${result.problems.join('; ')}`)
      }
    }
    const repo = `/repos/${this.fullName}`

    const baseCommit = await asInstallation<{ tree: { sha: string } }>(
      this.installationId,
      `${repo}/git/commits/${this.baseSha}`,
    )

    const tree = await Promise.all(
      changes.map(async (change) => {
        if (change.content === null) {
          return { path: change.path, mode: '100644', type: 'blob', sha: null }
        }
        const blob = await asInstallation<{ sha: string }>(this.installationId, `${repo}/git/blobs`, {
          method: 'POST',
          body: { content: Buffer.from(change.content, 'utf8').toString('base64'), encoding: 'base64' },
        })
        return { path: change.path, mode: '100644', type: 'blob', sha: blob.sha }
      }),
    )

    const newTree = await asInstallation<{ sha: string }>(this.installationId, `${repo}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseCommit.tree.sha, tree },
    })
    const commit = await asInstallation<{ sha: string }>(this.installationId, `${repo}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTree.sha, parents: [this.baseSha] },
    })
    if (options.onto) {
      await asInstallation(this.installationId, `${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: { sha: commit.sha, force: false },
      })
    } else {
      await asInstallation(this.installationId, `${repo}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha: commit.sha },
      })
    }

    return { sha: commit.sha, files: changes.map((change) => change.path) }
  }
}

/** A tool call the model can recover from; its message goes back to the model. */
export class WorkspaceError extends Error {}
