/**
 * Splitting documents into pieces small enough to embed and to quote. Pure.
 */

/** Sections by heading, then paragraphs, each at most `max` characters, headings carried along. */
export function chunkMarkdown(text: string, max = 1200): Array<{ heading: string | null; text: string }> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sections: Array<{ heading: string | null; body: string[] }> = [{ heading: null, body: [] }]
  let fenced = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = !fenced && /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) sections.push({ heading: heading[1], body: [] })
    else sections[sections.length - 1].body.push(line)
  }
  const out: Array<{ heading: string | null; text: string }> = []
  for (const section of sections) {
    const body = section.body.join('\n').trim()
    if (!body) continue
    const paragraphs = body.split(/\n\s*\n/)
    let current = ''
    for (const paragraph of paragraphs) {
      const piece = paragraph.trim()
      if (!piece) continue
      if ((current + '\n\n' + piece).length > max && current) {
        out.push({ heading: section.heading, text: current })
        current = ''
      }
      // A single paragraph longer than the limit is cut, not dropped.
      current = current ? `${current}\n\n${piece}` : piece.slice(0, max)
    }
    if (current) out.push({ heading: section.heading, text: current })
  }
  return out
}

/** Which repository files are worth reading as documentation. */
export function isDocPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (/(^|\/)(node_modules|vendor|dist|build|\.next|coverage)\//.test(lower)) return false
  if (/^(readme|contributing|architecture|agents|claude|conventions|changelog)(\.[a-z]+)?\.md$/.test(lower)) return true
  return /^(docs?|documentation|adr|decisions)\/.*\.mdx?$/.test(lower) || /^\.github\/(contributing|pull_request_template)\.md$/.test(lower)
}
