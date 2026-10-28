export type Tab = 'overview' | 'context' | 'changes' | 'agents' | 'tools' | 'config'

export type Env = {
  cwd: string
  root: string
  project: string
  branch: string | null
  remote: string | null
  model: string
  effort: string | null
  permissionMode: string | null
  version: string
  os: string
  sessionId: string
}

export type ContextInfo = {
  tokens: number
  window: number
  compactions: number
  lastCompactAt: number | null
}

export type Breakdown = {
  at: number
  categories: { name: string; tokens: number; color: string; kind: string }[]
  memoryFiles: { path: string; tokens: number }[]
  mcpTools: { name: string; server: string; tokens: number }[]
  skills: { name: string; tokens: number }[]
  autoCompactAt: number | null
}

export type FileChange = { path: string; status: string; added: number; removed: number }

export type Changes = {
  at: number
  branch: string | null
  /** Uncommitted: the working tree against HEAD, new untracked files counted by line. */
  files: FileChange[]
  /** The default branch the branch is compared with (`origin/master`), or null when there is none. */
  base: string | null
  /** Everything on this branch since it left `base`, uncommitted work included, as the app's Changes panel counts it. */
  branchFiles: FileChange[]
  /** Paths an Edit/Write of this session touched, relative to the repo root when inside it. */
  touched: string[]
  error: string | null
}

/** A file's diff against `against` (HEAD, or the branch's merge base). */
export type Diff = { path: string; against: string; patch: string }

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type ToolStat = { name: string; calls: number; errors: number; totalMs: number }
export type ToolCallRec = { name: string; ms: number; isError: boolean; at: number }
export type McpServer = { name: string; tools: number }

export type Tools = { stats: ToolStat[]; recent: ToolCallRec[]; mcp: McpServer[] }

export type ModelSpend = {
  model: string
  cost: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type UsageInfo = {
  startedAt: number
  cost: number | null
  windows: { kind: string; percentUsed: number; resetsAt?: string }[]
  /** When the main thread last sent a request: the prompt cache's clock. */
  lastMainAt: number
  byModel: ModelSpend[]
}

export type Config = {
  at: number
  memory: { path: string; chars: number }[]
  plugins: { name: string; commands: number }[]
  permissions: { allow: number; deny: number; ask: number; defaultMode: string | null }
  hooks: number
  commands: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-hub': {
      tab: Shaped<Tab>
      expanded: Shaped<string[]>
      now: number
      env: Shaped<Env | null>
      context: Shaped<ContextInfo>
      breakdown: Shaped<Breakdown | null>
      changes: Shaped<Changes>
      diffs: Shaped<Diff[]>
      agents: Shaped<AgentRun[]>
      tools: Shaped<Tools>
      usage: Shaped<UsageInfo>
      config: Shaped<Config | null>
    }
  }
}
