import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

import { DomainError } from '@/core/domain/errors'
import { fail, type ActionResult } from '@/core/domain/result'

/**
 * Translates any thrown value into a client-safe ActionResult.
 *
 * Server Actions must never leak a stack trace, a Prisma error or an internal
 * message across the boundary. Known error types are mapped to friendly copy;
 * anything unrecognised is logged server-side and reported generically.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof ZodError) {
    return fail('Please correct the highlighted fields.', {
      code: 'VALIDATION_ERROR',
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    })
  }

  if (error instanceof DomainError) {
    return fail(error.message, {
      code: error.code,
      fieldErrors: 'fieldErrors' in error
        ? (error as { fieldErrors?: Record<string, string[]> }).fieldErrors
        : undefined,
    })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | undefined)?.join(', ')
        return fail(
          target
            ? `That ${humanizeTarget(target)} is already in use.`
            : 'That value is already in use.',
          { code: 'CONFLICT' },
        )
      }
      case 'P2003':
        return fail('That change references a record that no longer exists.', {
          code: 'FK_VIOLATION',
        })
      case 'P2025':
        return fail('The record was not found — it may have been deleted.', {
          code: 'NOT_FOUND',
        })
      default:
        break
    }
  }

  console.error('[action] unhandled error:', error)
  return fail('Something went wrong. Please try again.', { code: 'INTERNAL' })
}

function humanizeTarget(target: string): string {
  return target
    .replace(/_/g, ' ')
    .replace(/\bkey\b/gi, '')
    .trim()
}

/**
 * Wraps an action body so callers always receive an ActionResult.
 *
 * Note: `redirect()` and `notFound()` from Next.js throw control-flow errors
 * that MUST propagate, so they are re-thrown untouched.
 */
export async function runAction<T>(
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await body()
  } catch (error) {
    if (isNextControlFlowError(error)) throw error
    return toActionError(error)
  }
}

function isNextControlFlowError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    ((error as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (error as { digest: string }).digest === 'NEXT_NOT_FOUND')
  )
}
