// Pure reducers and parsers behind the hub's state. No engine calls: register.tsx
// reads the engine and hands these plain values.

import type { AgentRun, Breakdown, Changes, Config, FileChange, ModelSpend, Tools, UsageInfo } from '../types'
import type { Usage } from './format'
import { costOf, tokensOf, windowOf } from './format'

// ---- usage ----

const ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }

/** 5-hour first, then 7-day, then anything else. */
export const windowsOf = (list: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): UsageInfo['windows'] =>
  list.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })).sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

/** One request's tokens and estimated cost added to its model's row. */
export const addSpend = (rows: ModelSpend[], model: string, u: Usage): ModelSpend[] => {
  const row = rows.find(m => m.model === model) ?? { model, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const next: ModelSpend = {
    ...row,
    cost: row.cost + costOf(model, u),
    input: row.input + (u.input_tokens || 0),
    output: row.output + (u.output_tokens || 0),
    cacheRead: row.cacheRead + (u.cache_read_input_tokens || 0),
    cacheWrite: row.cacheWrite + (u.cache_creation_input_tokens || 0),
  }
  return [...rows.filter(m => m.model !== model), next]
}

// ---- context ----

type RawBreakdown = {
  categories: readonly { name: string; tokens: number; color: string; kind: string }[]
  memoryFiles: readonly { path: string; tokens: number }[]
  mcpTools: readonly { name: string; serverName: string; tokens: number }[]
  skills?: { skillFrontmatter: readonly { name: string; tokens: number }[] }
  autoCompactThreshold?: number
}

export const breakdownOf = (b: RawBreakdown, at: number): Breakdown => ({
  at,
  categories: b.categories.filter(c => c.tokens > 0).map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
  memoryFiles: b.memoryFiles.map(m => ({ path: m.path, tokens: m.tokens })).sort((x, y) => y.tokens - x.tokens),
  mcpTools: b.mcpTools.map(m => ({ name: m.name, server: m.serverName, tokens: m.tokens })).sort((x, y) => y.tokens - x.tokens),
  skills: (b.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, tokens: s.tokens })).sort((x, y) => y.tokens - x.tokens),
  autoCompactAt: b.autoCompactThreshold ?? null,
})

// ---- changes ----

export const MAX_FILES = 200
export const MAX_PATCH = 20_000
export const MAX_DIFFS = 5
export const EDITORS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
/** Tools after which the working tree may have moved. */
export const CHANGERS = new Set([...EDITORS, 'Bash'])

export const EMPTY_CHANGES: Changes = { at: 0, branch: null, files: [], base: null, branchFiles: [], touched: [], error: null }
/** Untracked files counted by line at most; past this they show without counts. */
export const MAX_UNTRACKED = 300

/** `## main...origin/main [ahead 1]` → main. */
const branchOf = (line: string): string | null => {
  const m = /^## (?:No commits yet on )?(.+?)(?:\.\.\.|$| )/.exec(line)
  return m?.[1] && m[1] !== 'HEAD' ? m[1] : null
}

/** `git diff --numstat` → path → [added, removed]; a rename counts under its new path, a binary file as 0. */
export const parseNumstat = (numstat: string): Map<string, [number, number]> => {
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\n')) {
    const [a, d, ...rest] = line.split('\t')
    const path = rest.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, '')
    if (path) counts.set(path, [Number(a) || 0, Number(d) || 0])
  }
  return counts
}

/** `wc -l a b` → path → lines; the `total` line is dropped. */
export const parseWc = (out: string): Map<string, number> => {
  const lines = new Map<string, number>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (m && m[2] !== 'total') lines.set(m[2]!, Number(m[1]))
  }
  return lines
}

/** Fills in untracked files' added lines, which git's numstat leaves out. */
export const withLines = (files: FileChange[], lines: Map<string, number>): FileChange[] =>
  files.map(f => (f.status === '?' && lines.has(f.path) ? { ...f, added: lines.get(f.path)! } : f))

/** The branch's own changes (`git diff --numstat <merge-base>`) plus the untracked files, biggest first. */
export const branchFilesOf = (numstat: string, nameStatus: string, untracked: FileChange[]): FileChange[] => {
  const counts = parseNumstat(numstat)
  const status = new Map<string, string>()
  for (const line of nameStatus.split('\n')) {
    const [s, ...paths] = line.split('\t')
    const path = paths[paths.length - 1]
    if (s && path) status.set(path, s[0] ?? 'M')
  }
  const files: FileChange[] = [...counts].map(([path, [added, removed]]) => ({ path, status: status.get(path) ?? 'M', added, removed }))
  return [...files, ...untracked].sort((a, b) => b.added + b.removed - (a.added + a.removed)).slice(0, MAX_FILES * 5)
}

/** `git status --porcelain=v1 -b` and `git diff --numstat HEAD` → branch and changed files. */
export const parseStatus = (porcelain: string, numstat: string): { branch: string | null; files: FileChange[] } => {
  const counts = parseNumstat(numstat)
  let branch: string | null = null
  const files: FileChange[] = []
  for (const line of porcelain.split('\n')) {
    if (!line) continue
    if (line.startsWith('## ')) {
      branch = branchOf(line)
      continue
    }
    const xy = line.slice(0, 2)
    const path = line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')
    const status = xy === '??' ? '?' : (xy.trim()[0] ?? 'M')
    const [added, removed] = counts.get(path) ?? [0, 0]
    files.push({ path, status, added, removed })
  }
  return { branch, files: files.slice(0, MAX_FILES) }
}

export const clipPatch = (patch: string): string =>
  (patch.length > MAX_PATCH ? patch.slice(0, MAX_PATCH) + '\n… (diff clipped)' : patch) || '(no textual diff)'

/** A path relative to the repo root, when it is inside it. */
export const relative = (path: string, root: string): string => (path.startsWith(root + '/') ? path.slice(root.length + 1) : path)

// ---- agents ----

export const MAX_AGENTS = 200

export const spawnRun = (list: AgentRun[], run: AgentRun): AgentRun[] => [...list.filter(a => a.id !== run.id), run].slice(-MAX_AGENTS)

/** One request of a subagent: live context, tokens and cost. */
export const stepRun = (list: AgentRun[], agentId: string, model: string, effort: string | undefined, u: Usage): AgentRun[] =>
  list.map((a): AgentRun =>
    a.agentId !== agentId
      ? a
      : {
          ...a,
          model,
          effort: effort ?? a.effort,
          status: 'running',
          endedAt: undefined,
          contextTokens: tokensOf(u),
          contextMax: windowOf(model),
          tokens: a.tokens + tokensOf(u),
          costUsd: a.costUsd + costOf(model, u),
          steps: a.steps + 1,
        },
  )

/** A subagent's turn ended; a run whose requests went unseen still gets the turn's own sum. */
export const completeRun = (list: AgentRun[], agentId: string, isAnswer: boolean, at: number, usage?: Usage & { model?: string }): AgentRun[] =>
  list.map((a): AgentRun => {
    if (a.agentId !== agentId) return a
    const fallback = a.steps === 0 && usage ? { tokens: tokensOf(usage), costUsd: costOf(usage.model || a.model, usage) } : {}
    return { ...a, status: isAnswer ? 'done' : 'failed', endedAt: at, ...fallback }
  })

/** A worker's own step report (the agents mod's `step` tool). */
export const reportStep = (list: AgentRun[], agentId: string, input: { done?: number; total?: number; note?: string }): AgentRun[] =>
  list.map(a => {
    if (a.agentId !== agentId) return a
    const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
    const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
    return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
  })

// ---- tools ----

const MAX_RECENT = 50

/** `mcp__<server>__<tool>` → server. */
export const serverOf = (name: string): string | null => /^mcp__(.+?)__/.exec(name)?.[1] ?? null

export const mcpServers = (list: readonly { name: string; mcp: boolean }[]): Tools['mcp'] => {
  const counts = new Map<string, number>()
  for (const t of list) {
    const server = t.mcp ? serverOf(t.name) : null
    if (server) counts.set(server, (counts.get(server) ?? 0) + 1)
  }
  return [...counts].map(([name, tools]) => ({ name, tools })).sort((a, b) => b.tools - a.tools)
}

export const addCall = (prev: Tools, name: string, ms: number, isError: boolean, at: number): Tools => {
  const row = prev.stats.find(s => s.name === name) ?? { name, calls: 0, errors: 0, totalMs: 0 }
  const next = { ...row, calls: row.calls + 1, errors: row.errors + (isError ? 1 : 0), totalMs: row.totalMs + ms }
  return { ...prev, stats: [...prev.stats.filter(s => s.name !== name), next], recent: [...prev.recent, { name, ms, isError, at }].slice(-MAX_RECENT) }
}

// ---- config ----

export const MEMORY_NAMES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']

const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

/** Hook commands across every event of a settings `hooks` block. */
const hookCount = (hooks: unknown): number =>
  hooks && typeof hooks === 'object'
    ? Object.values(hooks as Record<string, unknown>).reduce<number>(
        (n, matchers) => n + (Array.isArray(matchers) ? matchers.reduce<number>((m, x) => m + count((x as { hooks?: unknown }).hooks), 0) : 0),
        0,
      )
    : 0

export const configOf = (
  memoryFiles: readonly { dir: string; name: string; content: string }[],
  commands: readonly { plugin?: string }[],
  settings: Record<string, unknown>,
  home: string,
  at: number,
): Config => {
  const seen = new Set<string>()
  const memory = memoryFiles.flatMap(f => {
    const path = `${f.dir}/${f.name}`
    if (seen.has(path)) return []
    seen.add(path)
    return [{ path: home && path.startsWith(home) ? '~' + path.slice(home.length) : path, chars: f.content.length }]
  })
  const byPlugin = new Map<string, number>()
  for (const c of commands) if (c.plugin) byPlugin.set(c.plugin, (byPlugin.get(c.plugin) ?? 0) + 1)
  const enabled = Object.entries((settings.enabledPlugins as Record<string, boolean> | undefined) ?? {}).flatMap(([id, on]) => (on ? [id.split('@')[0] ?? id] : []))
  for (const name of enabled) if (!byPlugin.has(name)) byPlugin.set(name, 0)
  const perms = (settings.permissions as Record<string, unknown> | undefined) ?? {}
  return {
    at,
    memory,
    plugins: [...byPlugin].map(([name, n]) => ({ name, commands: n })).sort((a, b) => a.name.localeCompare(b.name)),
    permissions: { allow: count(perms.allow), deny: count(perms.deny), ask: count(perms.ask), defaultMode: typeof perms.defaultMode === 'string' ? perms.defaultMode : null },
    hooks: hookCount(settings.hooks),
    commands: commands.length,
  }
}
