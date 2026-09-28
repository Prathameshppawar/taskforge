/**
 * Unified-diff helpers for AI review.
 *
 * GitHub accepts a review comment only on a line that appears in the pull
 * request's diff — an added or unchanged context line on the new side. One
 * comment on any other line makes GitHub reject the *whole* review, so every
 * line a model cites is checked against this before anything is posted.
 */

/**
 * The patch rewritten with the new-side line number in front of every line a
 * comment may target, so a model can cite `line` numbers that are real:
 *
 *     @@ -10,4 +10,5 @@
 *     10 | ·const a = 1
 *     11 | +const b = 2
 *        | -const c = 3
 */
export function annotatePatch(patch: string): { text: string; commentable: Set<number> } {
  const commentable = new Set<number>()
  const out: string[] = []
  let next = 0

  for (const raw of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      next = Number(hunk[1])
      out.push(raw)
      continue
    }
    if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    if (raw.startsWith('-')) {
      out.push(`     | ${raw}`)
      continue
    }
    if (raw.startsWith('+') || raw.startsWith(' ') || raw === '') {
      commentable.add(next)
      out.push(`${String(next).padStart(4)} | ${raw.startsWith('+') ? raw : `·${raw.slice(1)}`}`)
      next++
    }
  }
  return { text: out.join('\n'), commentable }
}

export interface ReviewComment {
  path: string
  line: number
  body: string
}

/**
 * Splits a model's comments into those GitHub will accept and those it would
 * reject. The rejected ones are not thrown away — they are folded into the
 * review body, so nothing the model noticed is lost.
 */
export function partitionComments(
  comments: ReviewComment[],
  commentable: ReadonlyMap<string, ReadonlySet<number>>,
): { inline: ReviewComment[]; general: ReviewComment[] } {
  const inline: ReviewComment[] = []
  const general: ReviewComment[] = []
  for (const comment of comments) {
    if (commentable.get(comment.path)?.has(comment.line)) inline.push(comment)
    else general.push(comment)
  }
  return { inline, general }
}
