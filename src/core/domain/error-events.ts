import { createHash } from 'node:crypto'

/**
 * Production errors, from whatever sends them.
 *
 * Accepted shapes: Sentry's webhooks (the integration platform's
 * `data.event`, and the legacy plugin's top-level `event`), and a plain JSON
 * body any app can POST — `{ message, stack?, level?, environment?, url?,
 * release? }`. Everything is read defensively: this is an unauthenticated-
 * looking endpoint whose only credential is the secret in its URL, and a
 * malformed payload must produce a clear refusal, never a crash.
 */

export interface ErrorEvent {
  title: string
  message: string
  level: 'fatal' | 'error' | 'warning' | 'info'
  environment: string | null
  /** A commit sha or release name, when the sender knows it. */
  release: string | null
  stack: string | null
  topFrame: string | null
  url: string | null
  /** A fingerprint the sender chose, which wins over ours. */
  fingerprint: string | null
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max = 2000): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

function levelOf(value: unknown): ErrorEvent['level'] {
  const level = typeof value === 'string' ? value.toLowerCase() : ''
  if (level === 'fatal' || level === 'critical') return 'fatal'
  if (level === 'warning' || level === 'warn') return 'warning'
  if (level === 'info' || level === 'debug' || level === 'log') return 'info'
  return 'error'
}

export function normalizeErrorPayload(body: unknown): ErrorEvent | null {
  if (!isObject(body)) return null

  // Sentry integration platform: { data: { event | error | issue } }; legacy
  // plugin: { event, message, culprit, url }.
  const data = isObject(body.data) ? body.data : null
  const sentry = (data && (isObject(data.event) ? data.event : isObject(data.error) ? data.error : null)) ?? (isObject(body.event) ? body.event : null)

  if (sentry) {
    const exception = isObject(sentry.exception) && Array.isArray(sentry.exception.values) ? sentry.exception.values : []
    const last = [...exception].reverse().find(isObject)
    const frames = last && isObject(last.stacktrace) && Array.isArray(last.stacktrace.frames) ? last.stacktrace.frames.filter(isObject) : []
    // Sentry orders frames oldest first; the crash site is the last in-app one.
    const crash = [...frames].reverse().find((frame) => frame.in_app === true) ?? frames[frames.length - 1]
    const frameLabel = (frame: Json) =>
      `${str(frame.filename, 300) ?? str(frame.module, 300) ?? '?'}${frame.lineno ? `:${frame.lineno}` : ''}${frame.function ? ` in ${str(frame.function, 200)}` : ''}`
    const type = last ? str(last.type, 200) : null
    const value = last ? str(last.value) : null
    const message = value ?? str(sentry.message) ?? str(body.message) ?? str(sentry.title) ?? 'Unknown error'

    return {
      title: (str(sentry.title, 300) ?? (type ? `${type}: ${message}` : message)).slice(0, 300),
      message,
      level: levelOf(sentry.level ?? body.level),
      environment: str(sentry.environment, 100),
      release: str(sentry.release, 200),
      stack: frames.length ? [...frames].reverse().slice(0, 25).map((frame) => `  at ${frameLabel(frame)}`).join('\n') : null,
      topFrame: crash ? frameLabel(crash) : str(sentry.culprit ?? body.culprit, 300),
      url: str(sentry.web_url, 500) ?? str(body.url, 500),
      fingerprint: Array.isArray(sentry.fingerprint) && sentry.fingerprint.every((part) => typeof part === 'string') && !sentry.fingerprint.includes('{{ default }}')
        ? (sentry.fingerprint as string[]).join('|').slice(0, 500)
        : null,
    }
  }

  // Generic.
  const message = str(body.message) ?? str(body.title) ?? str(body.error)
  if (!message) return null
  const stack = str(body.stack, 8000)
  const firstFrame = stack?.split('\n').map((line) => line.trim()).find((line) => line.startsWith('at ')) ?? null
  return {
    title: (str(body.title, 300) ?? message).slice(0, 300),
    message,
    level: levelOf(body.level),
    environment: str(body.environment, 100),
    release: str(body.release, 200) ?? str(body.commit, 200),
    stack,
    topFrame: firstFrame ? firstFrame.replace(/^at\s+/, '').slice(0, 300) : null,
    url: str(body.url, 500),
    fingerprint: str(body.fingerprint, 500),
  }
}

/**
 * The same bug, whatever the user id or amount in its message. Numbers, hex
 * ids, UUIDs, emails and quoted values are masked before hashing, and the top
 * frame is included with its line number removed, so an edit elsewhere in the
 * file does not split one error into two.
 */
export function maskMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, '<str>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .trim()
}

export function fingerprintOf(event: ErrorEvent): string {
  if (event.fingerprint) return createHash('sha256').update(`custom:${event.fingerprint}`).digest('hex').slice(0, 40)
  const frame = (event.topFrame ?? '').replace(/:\d+(:\d+)?/g, '')
  return createHash('sha256').update(`${maskMessage(event.message)}\n${frame}`).digest('hex').slice(0, 40)
}
