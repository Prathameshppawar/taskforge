/**
 * Every AI engine TaskForge can use, in one place.
 *
 * Three have their own adapters (Anthropic's SDK, OpenAI's, Groq's). Every
 * other entry speaks the OpenAI chat-completions protocol at its own base URL,
 * so one adapter serves them all and adding a provider is a row here, not code.
 *
 * Each entry says plainly what a workspace is agreeing to: whether there is a
 * free tier and on what terms, and where requests are processed. This is not
 * decoration. "Fix with AI" sends a repository's code, and a ticket's text, to
 * the engine — for a client's codebase, "processed in China" or "free-tier
 * prompts may be used for training" is a decision someone has to make on
 * purpose.
 *
 * Free tiers change often; the notes were checked in September 2026 and each
 * links to the provider's page, which is the source of truth.
 */

export type EngineAdapter = 'anthropic' | 'openai' | 'groq' | 'openai-compatible'

export interface EngineDefinition {
  id: string
  label: string
  adapter: EngineAdapter
  /** OpenAI-compatible base URL, ending before /chat/completions. */
  baseUrl?: string
  /** Environment variable that may hold its key; others are set on the AI page. */
  envKey?: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'GROQ_API_KEY'
  keysUrl: string
  defaultModel: string
  suggestedModels: string[]
  /** "permanent": free without a card; "credits": free allowance or trial; null: paid only. */
  freeTier: 'permanent' | 'credits' | null
  /** The terms, briefly, in the provider's own numbers. */
  freeNote?: string
  /** Where requests are processed, as far as the provider says. */
  region: string
  /** Anything about data handling a workspace should decide on knowingly. */
  dataNote?: string
  /** The provider's name in LiteLLM's price catalogue, and how it prefixes model keys there. */
  priceCatalog?: { provider: string; prefix?: string }
  /** Is it the most capable tier? Used to order "Fix with AI" defaults. */
  rank: number
}

export const ENGINE_CATALOG: readonly EngineDefinition[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    adapter: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5',
    suggestedModels: ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'],
    freeTier: null,
    region: 'United States',
    priceCatalog: { provider: 'anthropic' },
    rank: 1,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    adapter: 'openai',
    envKey: 'OPENAI_API_KEY',
    keysUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5',
    suggestedModels: ['gpt-5', 'gpt-5-mini'],
    freeTier: null,
    region: 'United States',
    priceCatalog: { provider: 'openai' },
    rank: 2,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    adapter: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keysUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    freeTier: 'permanent',
    freeNote: 'Free tier with no card: about 1,500 requests a day on Flash, fewer on Pro.',
    region: 'United States (Google)',
    dataNote: 'On the free tier Google may use prompts to improve its models; the paid tier does not.',
    priceCatalog: { provider: 'gemini', prefix: 'gemini/' },
    rank: 3,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    freeTier: null,
    freeNote: 'Paid, but among the cheapest capable models.',
    region: 'China',
    dataNote: 'Requests are processed in China.',
    priceCatalog: { provider: 'deepseek', prefix: 'deepseek/' },
    rank: 4,
  },
  {
    id: 'groq',
    label: 'Groq',
    adapter: 'groq',
    envKey: 'GROQ_API_KEY',
    keysUrl: 'https://console.groq.com/keys',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    freeTier: 'permanent',
    freeNote: 'Free tier with no card: rate-limited per minute and per day.',
    region: 'United States',
    priceCatalog: { provider: 'groq', prefix: 'groq/' },
    rank: 5,
  },
  {
    id: 'zhipu',
    label: 'Zhipu GLM (Z.ai)',
    adapter: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keysUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    defaultModel: 'glm-4.7-flash',
    suggestedModels: ['glm-4.7-flash', 'glm-5.3-flash', 'glm-4.5-flash', 'glm-5.1'],
    freeTier: 'permanent',
    freeNote: 'The -Flash models are free, one request at a time.',
    region: 'China',
    dataNote: 'Requests are processed in China.',
    priceCatalog: { provider: 'zai', prefix: 'zai/' },
    rank: 6,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    keysUrl: 'https://platform.moonshot.ai/console/api-keys',
    defaultModel: 'kimi-k2.6',
    suggestedModels: ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.5'],
    freeTier: null,
    freeNote: 'Paid; low cost.',
    region: 'China',
    dataNote: 'Requests are processed in China.',
    priceCatalog: { provider: 'moonshot', prefix: 'moonshot/' },
    rank: 7,
  },
  {
    id: 'qwen',
    label: 'Alibaba Qwen (DashScope)',
    adapter: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keysUrl: 'https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key',
    defaultModel: 'qwen-plus',
    suggestedModels: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    freeTier: 'credits',
    freeNote: 'A free token allowance for new accounts, then paid.',
    region: 'Singapore (international endpoint)',
    dataNote: 'Alibaba Cloud; the international endpoint processes requests in Singapore.',
    priceCatalog: { provider: 'dashscope', prefix: 'dashscope/' },
    rank: 8,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    keysUrl: 'https://cloud.siliconflow.cn/account/ak',
    defaultModel: 'Qwen/Qwen3-8B',
    suggestedModels: ['Qwen/Qwen3-8B', 'THUDM/GLM-4.1V-9B-Thinking'],
    freeTier: 'permanent',
    freeNote: 'Several small models are free (1,000 requests/min, 50k tokens/min) after identity verification.',
    region: 'China',
    dataNote: 'Requests are processed in China.',
    rank: 9,
  },
  {
    id: 'modelscope',
    label: 'Alibaba ModelScope',
    adapter: 'openai-compatible',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    keysUrl: 'https://modelscope.cn/my/myaccesstoken',
    defaultModel: 'Qwen/Qwen3.5-35B-A3B',
    suggestedModels: ['Qwen/Qwen3.5-35B-A3B'],
    freeTier: 'permanent',
    freeNote: 'Free: about 2,000 requests a day, with an Alibaba Cloud account linked.',
    region: 'China',
    dataNote: 'Requests are processed in China.',
    rank: 10,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    adapter: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/settings/keys',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
    suggestedModels: ['deepseek/deepseek-chat-v3-0324:free', 'openai/gpt-oss-120b:free'],
    freeTier: 'permanent',
    freeNote: 'Models ending ":free" cost nothing: 20 requests/min, 50 a day (1,000 with $10 of credit).',
    region: 'Varies by the model routed to',
    dataNote: 'A router: the request goes on to whichever provider serves the model, some of which log prompts on free routes.',
    priceCatalog: { provider: 'openrouter', prefix: 'openrouter/' },
    rank: 11,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    adapter: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keysUrl: 'https://build.nvidia.com/settings/api-keys',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b'],
    freeTier: 'permanent',
    freeNote: 'Free with a developer account: about 40 requests a minute.',
    region: 'United States',
    rank: 12,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    keysUrl: 'https://console.mistral.ai/api-keys',
    defaultModel: 'mistral-large-latest',
    suggestedModels: ['mistral-large-latest', 'codestral-latest', 'ministral-8b-latest'],
    freeTier: 'permanent',
    freeNote: 'A free "Experiment" plan, rate-limited, for evaluation.',
    region: 'European Union',
    priceCatalog: { provider: 'mistral', prefix: 'mistral/' },
    rank: 13,
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    keysUrl: 'https://cloud.cerebras.ai/platform',
    defaultModel: 'gpt-oss-120b',
    suggestedModels: ['gpt-oss-120b'],
    freeTier: 'permanent',
    freeNote: 'Free tier with daily token limits; very fast.',
    region: 'United States',
    priceCatalog: { provider: 'cerebras', prefix: 'cerebras/' },
    rank: 14,
  },
  {
    id: 'custom',
    label: 'Any OpenAI-compatible endpoint',
    adapter: 'openai-compatible',
    keysUrl: 'https://platform.openai.com/docs/api-reference/chat',
    defaultModel: '',
    suggestedModels: [],
    freeTier: null,
    region: 'Wherever you point it',
    dataNote: 'Requests go to the base URL you enter; you are responsible for where that is.',
    rank: 15,
  },
]

const BY_ID = new Map(ENGINE_CATALOG.map((engine) => [engine.id, engine]))

export function engineDefinition(id: string): EngineDefinition | undefined {
  return BY_ID.get(id)
}

export function isEngineId(id: string): boolean {
  return BY_ID.has(id)
}

/** LiteLLM provider name → engine, for reading the price catalogue. */
export function priceCatalogMapping(): Map<string, { engineId: string; prefix?: string }> {
  const mapping = new Map<string, { engineId: string; prefix?: string }>()
  for (const engine of ENGINE_CATALOG) {
    if (engine.priceCatalog) mapping.set(engine.priceCatalog.provider, { engineId: engine.id, prefix: engine.priceCatalog.prefix })
  }
  return mapping
}
