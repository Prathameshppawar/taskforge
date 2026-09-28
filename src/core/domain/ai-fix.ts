/**
 * Rules for "Fix with AI" that do not need a model, GitHub or a database.
 *
 * The model's output is untrusted in exactly the way user input is: a ticket
 * description can carry instructions, and the model may follow them. So the
 * limits live here, in code the model cannot talk its way past, rather than in
 * the prompt.
 */

/**
 * Normalises a repository path the model supplied, or explains why it is
 * refused.
 *
 * Refused: anything escaping the repository, git internals, env files — which
 * should never be committed and which a model has no business writing — and
 * CI workflow files unless the project has opted in. A workflow runs with the
 * repository's secrets, so even then each one must pass `checkWorkflow`.
 */
export function checkRepoPath(
  raw: string,
  options: { allowWorkflows?: boolean } = {},
): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!trimmed) return { ok: false, reason: 'Empty path.' }
  if (trimmed.startsWith('/')) return { ok: false, reason: 'Use a path relative to the repository root.' }

  const parts = trimmed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) return { ok: false, reason: 'Paths may not leave the repository.' }
  if (parts.length === 0) return { ok: false, reason: 'Empty path.' }

  const path = parts.join('/')
  const lower = path.toLowerCase()

  if (parts[0] === '.git') return { ok: false, reason: 'Git internals are off limits.' }
  if (lower.startsWith('.github/workflows/')) {
    if (!options.allowWorkflows) {
      return {
        ok: false,
        reason: 'CI workflow files cannot be changed here. A project manager can allow it in project settings.',
      }
    }
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) {
      return { ok: false, reason: 'Workflows must be .yml or .yaml files directly in .github/workflows/.' }
    }
  }
  const file = parts[parts.length - 1].toLowerCase()
  if (file === '.env' || (file.startsWith('.env.') && file !== '.env.example')) {
    return { ok: false, reason: 'Environment files cannot be written.' }
  }

  return { ok: true, path }
}

/**
 * Applies an exact-match edit. The old text must appear exactly once: zero
 * means the model is looking at a stale or imagined version of the file, and
 * more than one means the edit is ambiguous — both are reported back so the
 * model can re-read and try again, rather than guessed at.
 */
export function applyEdit(
  content: string,
  oldText: string,
  newText: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  if (!oldText) return { ok: false, reason: 'old_text must not be empty. Use write_file to create a file.' }
  const first = content.indexOf(oldText)
  if (first === -1) return { ok: false, reason: 'old_text was not found. Read the file again and copy the text exactly.' }
  if (content.indexOf(oldText, first + oldText.length) !== -1) {
    return { ok: false, reason: 'old_text appears more than once. Include more surrounding lines so it is unique.' }
  }
  return { ok: true, content: content.slice(0, first) + newText + content.slice(first + oldText.length) }
}

/** Branch for a run: the ticket's usual branch, with a suffix if it is taken. */
export function uniqueBranch(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** Files skipped when listing a repository: noise, and too big to be useful. */
export function isListable(path: string): boolean {
  return !/(^|\/)(node_modules|\.git|dist|build|\.next|vendor|coverage)(\/|$)/.test(path)
}

/** Extensions treated as binary: never read into a prompt. */
export function looksBinary(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|wasm|jar|exe|dll|so|dylib|bin)$/i.test(path)
}
