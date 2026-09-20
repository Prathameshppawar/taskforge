import { z } from 'zod'

/**
 * Environment contract.
 *
 * Validated lazily (on first access) rather than at module load so that
 * `next build` — which imports modules without a populated runtime env — does
 * not fail during static analysis. Anything genuinely required at request time
 * throws a descriptive error the first time it is read.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_URL: z.string().url().optional(),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(28800),

  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  AI_PROVIDER: z.enum(['groq', 'ollama', 'none']).default('none'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(2048),

  /**
   * Semantic similarity. Runs in-process with no API key and no per-call cost,
   * so it is on by default; 'none' falls everything back to lexical matching.
   */
  EMBEDDING_PROVIDER: z.enum(['local', 'none']).default('local'),

  CRON_SECRET: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | null = null

export function env(): ServerEnv {
  if (cached) return cached

  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment configuration.\n${issues}\n\n` +
        'Copy .env.example to .env and fill in the required values.',
    )
  }

  cached = parsed.data
  return cached
}

/** True when the Copilot has a usable provider configured. */
export function isAiEnabled(): boolean {
  try {
    const e = env()
    if (e.AI_PROVIDER === 'none') return false
    if (e.AI_PROVIDER === 'groq') return Boolean(e.GROQ_API_KEY)
    return Boolean(e.OLLAMA_BASE_URL)
  } catch {
    return false
  }
}

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'TaskForge'
