/**
 * Attachment rules.
 *
 * Serving files somebody else uploaded is the part of this feature that can
 * actually hurt you, so the decisions are here, in one place, and the pure ones
 * are asserted in the domain suite.
 */

/** Per file. Screenshots and logs fit comfortably; video does not, by design. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** Per ticket, so one ticket cannot become a file share. */
export const MAX_ATTACHMENTS_PER_TICKET = 20

/**
 * Types rendered inline.
 *
 * SVG is deliberately absent. It is an image everywhere else in the product,
 * but to a browser it is a document that may contain script — serving one
 * inline from our own origin would hand an uploader a stored XSS with access to
 * the session cookie. It uploads fine; it just downloads rather than renders.
 */
const INLINE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
])

export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(normaliseType(contentType))
}

/** Strips parameters and casing: "IMAGE/PNG; charset=x" -> "image/png". */
export function normaliseType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}

/**
 * How the file should be served.
 *
 * Anything not on the inline list is forced to download. That turns an HTML or
 * SVG upload from a script running on our origin into a file sitting in the
 * downloads folder.
 */
export function contentDisposition(filename: string, contentType: string): string {
  const mode = isInlineType(contentType) ? 'inline' : 'attachment'
  return `${mode}; filename="${sanitiseFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/**
 * A filename safe to put inside a quoted header.
 *
 * Quotes, backslashes and control characters would let an upload break out of
 * the quoted string and inject header directives, so they are removed rather
 * than escaped. The original name still reaches the browser through the
 * RFC 5987 `filename*` parameter beside it.
 */
export function sanitiseFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .replace(/[\r\n]/g, '')
    .trim()
  return cleaned.slice(0, 120) || 'download'
}

/**
 * The type we will store, which is not always the one the browser claimed.
 *
 * A client can send any Content-Type it likes. Storing an unrecognised one and
 * echoing it back later would let an uploader choose how their bytes are
 * interpreted, so anything unknown becomes a plain stream — which browsers
 * download rather than execute.
 */
export function storedContentType(claimed: string): string {
  const type = normaliseType(claimed)
  if (!type || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) return 'application/octet-stream'
  if (type === 'image/svg+xml') return type // stored honestly, served as a download
  return type
}

export type AttachmentRejection = { ok: true } | { ok: false; reason: string }

export function validateUpload(
  size: number,
  existingCount: number,
): AttachmentRejection {
  if (size <= 0) return { ok: false, reason: 'That file is empty.' }

  if (size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `Files are limited to ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB. Link to it instead under Resources.`,
    }
  }

  if (existingCount >= MAX_ATTACHMENTS_PER_TICKET) {
    return {
      ok: false,
      reason: `A ticket can hold ${MAX_ATTACHMENTS_PER_TICKET} attachments. Remove one first.`,
    }
  }

  return { ok: true }
}

/** Human-readable size, for the UI. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
