import { env } from '@/lib/env'

/**
 * Sentence embeddings.
 *
 * Deliberately a different port from `AiProvider`. Chat and embedding have
 * almost nothing in common operationally: chat is a paid, rate-limited, remote
 * call measured in seconds, whereas this runs in-process in single-digit
 * milliseconds and costs nothing. Tying them together would mean an outage or a
 * spent quota on one silently disabled the other.
 *
 * The model is `bge-small-en-v1.5`, quantised: 384 dimensions, about 33MB, and
 * good enough to score "users cannot sign in" against "login redirect broken"
 * at 0.67 — a pair that shares no words at all and that lexical matching
 * therefore rates zero.
 */

export interface Embedder {
  readonly id: string
  readonly model: string
  readonly dimensions: number
  /** Embeds a batch. Vectors are L2-normalised, so a dot product IS the cosine. */
  embed(texts: string[]): Promise<Float32Array[]>
}

export const EMBEDDING_DIMENSIONS = 384
const MODEL = 'Xenova/bge-small-en-v1.5'

/**
 * Loaded once per process and shared. The first call pays roughly 2.5 seconds
 * to load the weights; every call after it is a few milliseconds, so the cost
 * is per *process*, not per request.
 */
let pipelinePromise: Promise<unknown> | null = null

async function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env: transformersEnv } = await import('@xenova/transformers')

      /*
       * Weights are cached on disk. A serverless filesystem is read-only apart
       * from the temp directory, so writing anywhere else fails outright —
       * hence the split. The cache survives for the life of an instance, which
       * means the download is paid once per cold start rather than per call.
       */
      transformersEnv.cacheDir =
        process.env.TRANSFORMERS_CACHE ??
        (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
          ? '/tmp/transformers'
          : './.cache/transformers')
      transformersEnv.allowLocalModels = false

      return pipeline('feature-extraction', MODEL)
    })().catch((error) => {
      // Reset, so a transient failure (a network blip while fetching weights)
      // does not poison every later call in this process.
      pipelinePromise = null
      throw error
    })
  }
  return pipelinePromise
}

class LocalEmbedder implements Embedder {
  readonly id = 'local'
  readonly model = MODEL
  readonly dimensions = EMBEDDING_DIMENSIONS

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []

    const extractor = (await getPipeline()) as (
      input: string[],
      options: { pooling: 'mean'; normalize: boolean },
    ) => Promise<{ data: Float32Array; dims: number[] }>

    const output = await extractor(texts, { pooling: 'mean', normalize: true })

    // The batch comes back as one flat buffer of `texts.length * dimensions`.
    const vectors: Float32Array[] = []
    for (let i = 0; i < texts.length; i++) {
      vectors.push(
        output.data.slice(i * this.dimensions, (i + 1) * this.dimensions) as Float32Array,
      )
    }
    return vectors
  }
}

let cached: Embedder | null = null

/**
 * The configured embedder, or null when embedding is switched off.
 *
 * Null is a supported state, not a failure: every caller falls back to lexical
 * matching, so a deployment that cannot run the model still works — it is just
 * less good at spotting a rephrased duplicate.
 */
export function getEmbedder(): Embedder | null {
  if (env().EMBEDDING_PROVIDER === 'none') return null
  if (!cached) cached = new LocalEmbedder()
  return cached
}

/** The text a ticket is embedded from. One definition, used by every caller. */
export function embeddableText(title: string, description?: string | null): string {
  const body = (description ?? '').trim()
  // The title carries most of the signal, and a long description would drown it
  // once mean-pooled, so the body is capped rather than truncating the whole.
  return body ? `${title}\n\n${body.slice(0, 2000)}` : title
}
