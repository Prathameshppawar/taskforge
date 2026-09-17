import bcrypt from 'bcryptjs'
import { env } from '@/lib/env'

/**
 * Password hashing.
 *
 * `bcryptjs` (pure JS) is used rather than the native `bcrypt` binding: it needs
 * no compilation step, which keeps the Vercel build reproducible and avoids
 * native-module failures in serverless bundles. The algorithm and cost factor
 * are identical; only the implementation differs.
 */
export async function hashPassword(plain: string): Promise<string> {
  const rounds = env().BCRYPT_ROUNDS
  return bcrypt.hash(plain, rounds)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Constant-ish work even when a username does not exist, so response timing
 * cannot be used to enumerate valid accounts.
 */
const DUMMY_HASH = '$2a$12$K4gVQ3zS8nZ1xLm9pQwXu.Wl0rJ7hYcT2vBnM5sD8fA1gH3jK6lPe'

export async function fakeVerify(): Promise<void> {
  await bcrypt.compare('never-matches', DUMMY_HASH)
}

export interface PasswordStrength {
  valid: boolean
  issues: string[]
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const issues: string[] = []
  if (password.length < 8) issues.push('Use at least 8 characters.')
  if (!/[a-z]/.test(password)) issues.push('Include a lowercase letter.')
  if (!/[A-Z]/.test(password)) issues.push('Include an uppercase letter.')
  if (!/\d/.test(password)) issues.push('Include a number.')
  return { valid: issues.length === 0, issues }
}
