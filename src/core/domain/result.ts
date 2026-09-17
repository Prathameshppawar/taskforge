/**
 * Discriminated result returned by every Server Action.
 *
 * Actions never throw across the server/client boundary — they resolve to this
 * shape so forms can render field-level errors without a try/catch.
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | {
      success: false
      error: string
      code?: string
      fieldErrors?: Record<string, string[]>
    }

export function ok(): ActionResult<void>
export function ok<T>(data: T): ActionResult<T>
export function ok<T>(data?: T): ActionResult<T | void> {
  return { success: true, data: data as T }
}

export function fail(
  error: string,
  options?: { code?: string; fieldErrors?: Record<string, string[]> },
): ActionResult<never> {
  return {
    success: false,
    error,
    code: options?.code,
    fieldErrors: options?.fieldErrors,
  }
}
