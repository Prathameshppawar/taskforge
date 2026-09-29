/**
 * Turning a ticket's attachments and links into text a model can read.
 * Pure, so the domain suite pins it.
 */

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|env\.example|xml|html?|css|scss|log|sql|graphql|gql|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|php|cs|c|h|cpp|hpp|sh|bash|zsh|ps1|dockerfile|tf|prisma|vue|svelte)$/i

/** Whether an attachment is text worth reading into a prompt. */
export function isTextAttachment(filename: string, contentType: string): boolean {
  if (/^text\//i.test(contentType)) return true
  if (/(json|xml|yaml|csv|javascript|typescript|x-sh|sql|graphql)/i.test(contentType)) return true
  return TEXT_EXTENSIONS.test(filename) || /^(dockerfile|makefile|readme|license)$/i.test(filename)
}

/**
 * A web page as plain text: scripts, styles and markup removed, entities
 * decoded, whitespace collapsed. Good enough to read a spec or a doc page;
 * not a browser.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

/**
 * A GitHub file or repository link, parsed: `github.com/o/r/blob/<ref>/<path>`
 * names a file; `github.com/o/r` names a repository (whose README is read).
 */
export function parseGithubLink(raw: string): { owner: string; repo: string; ref: string | null; path: string | null } | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.hostname !== 'github.com') return null
  const [owner, repo, kind, ref, ...rest] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repo) return null
  if (kind === 'blob' && ref && rest.length) return { owner, repo: repo.replace(/\.git$/, ''), ref, path: rest.join('/') }
  if (!kind) return { owner, repo: repo.replace(/\.git$/, ''), ref: null, path: null }
  return null
}

/** Cuts text to a budget at a line boundary, saying that it did. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastBreak = cut.lastIndexOf('\n')
  return `${lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut}\n… (${text.length - max} more characters not shown)`
}
