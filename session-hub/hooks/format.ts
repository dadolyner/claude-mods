// Numbers, money, time and model names as the hub writes them, plus the price table
// its cost estimates use (copied from the agents mod: mods cannot import each other).

export const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 18m, 2h 5m, 3d 9h. */
export const fmtSpan = (ms: number): string => {
  const mins = Math.max(0, Math.floor(ms / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const fmtMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)

export const pct = (part: number, whole: number): number => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0)

export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

/** The last path segment. */
export const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p

// USD per million tokens: input, output, cache read, cache write. The first row that
// matches a model id wins, so a release sits above its family. Cache writes are priced
// at the 1-hour rate (2x input), which is what Claude Code writes on a subscription.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 requests whose prompt is over 100K tokens pay these prices instead.
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const promptOf = (u: Usage): number =>
  (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

export const tokensOf = (u: Usage): number => promptOf(u) + (u.output_tokens || 0)

/** One model request's estimated cost. */
export const costOf = (model: string, u: Usage): number => {
  const id = model.toLowerCase()
  const [i, o, r, w] =
    promptOf(u) > 100_000 && /haiku-5-5/.test(id) ? HAIKU_LONG : (PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8])
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
}

/** The cost of the next request re-sending `tokens` of context: a cache read while warm, a 1-hour write while cold. */
export const nextCost = (model: string, tokens: number, isCold: boolean): number =>
  costOf(model, isCold ? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: tokens } : { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0 })

// Haiku 4.5 and the Claude 3 models have a 200K window; the rest 1M.
export const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

/** The prompt cache lives an hour after the last request that read or wrote it. */
export const CACHE_TTL_MS = 60 * 60 * 1000
