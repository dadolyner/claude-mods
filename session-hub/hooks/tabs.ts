import type { AgentRun, Breakdown, Changes, Config, ContextInfo, Diff, Env, FileChange, Tab, Tools, UsageInfo } from '../types'
import type { BarRow, Block, Kv, Press, Span } from './blocks'
import { C } from './blocks'
import { baseName, fmtCost, fmtMs, fmtSpan, fmtTokens, modelName, pct } from './format'
import { serverOf } from './model'

// Each tab turns a snapshot of the hub's state into blocks. Pure: anything that
// fetches (git, the context breakdown) is an action register.tsx supplies.

export type Data = {
  env: Env | null
  context: ContextInfo
  breakdown: Breakdown | null
  changes: Changes
  diffs: Diff[]
  agents: AgentRun[]
  tools: Tools
  usage: UsageInfo
  config: Config | null
}

export type Actions = {
  /** A ▸/▾ button flipping `key` in the expanded list; `onOpen` runs as it opens. */
  toggle: (key: string, isOpen: boolean, onOpen?: () => Promise<void>) => Press
  refreshBreakdown: () => Promise<void>
  refreshChanges: () => Promise<void>
  refreshMcp: () => Promise<void>
  refreshConfig: () => Promise<void>
  loadDiff: (path: string, status: string, against: string) => Promise<void>
}

export type Ctx = { d: Data; a: Actions; at: number; expanded: string[] }

/** The tab strip: one glyph each, the name for the accessible label and the title line. */
export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '⌂' },
  { id: 'context', label: 'Context', icon: '◔' },
  { id: 'changes', label: 'Changes', icon: '±' },
  { id: 'agents', label: 'Agents', icon: '⚇' },
  { id: 'tools', label: 'Tools', icon: '⚒' },
  { id: 'config', label: 'Config', icon: '⚙' },
]

const refresh = (key: string, fn: () => Promise<void>): Press => ({ key, label: '↻ Refresh', onPress: fn })

/**
 * A foldable section. `open` is its default; a press flips it, remembered as the
 * key being in the expanded list, so the default can change without stale state.
 */
const section = (c: Ctx, id: string, title: string, body: Block[], o: { note?: string; open?: boolean } = {}): Block => {
  const key = `sec:${id}`
  const flipped = c.expanded.includes(key)
  const isOpen = (o.open ?? true) !== flipped
  return { t: 'section', key, title, note: o.note, isOpen, toggle: { ...c.a.toggle(key, flipped), label: isOpen ? '▾' : '▸' }, body }
}

const ratioColor = (p: number): string => (p >= 80 ? C.red : p >= 50 ? C.yellow : C.green)

const home = (path: string, root: string): string => {
  const m = /^\/Users\/[^/]+|^\/home\/[^/]+/.exec(path)
  return m ? '~' + path.slice(m[0].length) : path || root
}

const num = (n: number): string => n.toLocaleString('en-US')

const files = (n: number): string => `${num(n)} ${n === 1 ? 'file' : 'files'}`

/** `+12 −3`, the additions green and the removals red. */
const plusMinus = (added: number, removed: number): Span[] => [
  { text: `+${num(added)} `, color: C.green },
  { text: `−${num(removed)}`, color: C.red },
]

/** "just now", "3m ago". */
const ago = (ms: number): string => (ms < 60_000 ? 'just now' : `${fmtSpan(ms)} ago`)

// ---------------------------------------------------------------------------

const overview = (c: Ctx): Block[] => {
  const { env, context: ctx, usage, agents, changes, tools, config } = c.d
  const used = pct(ctx.tokens, ctx.window)
  const running = agents.filter(a => a.status === 'running').length
  const branchAdded = changes.branchFiles.reduce((n, f) => n + f.added, 0)
  const branchRemoved = changes.branchFiles.reduce((n, f) => n + f.removed, 0)
  const tiles: Kv[] = [
    { k: 'Context', v: ctx.window ? `${used}%` : '—', color: ctx.window ? ratioColor(used) : undefined },
    { k: 'Spent', v: usage.cost === null ? '—' : fmtCost(usage.cost) },
    { k: 'Session', v: usage.startedAt ? fmtSpan(c.at - usage.startedAt) : '—' },
    { k: 'Agents', v: running ? `${running} running` : `${agents.length} total`, color: running ? C.accent : undefined },
    changes.base
      ? { k: 'Branch changes', v: '', spans: plusMinus(branchAdded, branchRemoved) }
      : { k: 'Changes', v: files(changes.files.length) },
    { k: 'Tool calls', v: num(tools.stats.reduce((n, s) => n + s.calls, 0)) },
  ]
  if (!env) return [{ t: 'tiles', rows: tiles }, { t: 'note', text: 'Reading the environment…' }]
  return [
    { t: 'tiles', rows: tiles },
    section(c, 'env', 'Environment', [
      {
        t: 'kv',
        rows: [
          { k: 'Project', v: env.project },
          { k: 'Branch', v: changes.branch ?? env.branch ?? '—', color: C.accent },
          { k: 'Directory', v: home(env.cwd, env.root) },
          { k: 'Model', v: env.effort ? `${modelName(env.model)} · ${env.effort}` : modelName(env.model) },
          // Another plugin may answer the prompt hook first; settings' default mode is the fallback.
          { k: 'Permission mode', v: env.permissionMode ?? config?.permissions.defaultMode ?? 'default' },
          ...(env.remote ? [{ k: 'Remote', v: env.remote.replace(/^git@|^https?:\/\//, '').replace(/\.git$/, '') }] : []),
        ],
      },
    ]),
  ]
}

const context = (c: Ctx): Block[] => {
  const { context: ctx, breakdown: b } = c.d
  const used = pct(ctx.tokens, ctx.window)
  const top = <T extends { tokens: number }>(list: T[], label: (x: T) => string, color: string): BarRow[] => {
    const max = Math.max(1, ...list.map(x => x.tokens))
    return list.slice(0, 8).map(x => ({ label: label(x), value: fmtTokens(x.tokens), ratio: x.tokens / max, color }))
  }
  const blocks: Block[] = [
    {
      t: 'tiles',
      rows: [
        { k: 'Used', v: ctx.window ? `${used}%` : '—', color: ctx.window ? ratioColor(used) : undefined },
        { k: 'Tokens', v: ctx.window ? `${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.window)}` : '—' },
        { k: 'Compactions', v: String(ctx.compactions) },
      ],
    },
    { t: 'bars', rows: [{ label: 'Context window', value: `${used}%`, ratio: used / 100, color: ratioColor(used) }] },
  ]
  if (ctx.lastCompactAt || b?.autoCompactAt) {
    blocks.push({
      t: 'kv',
      rows: [
        ...(b?.autoCompactAt ? [{ k: 'Auto-compacts at', v: fmtTokens(b.autoCompactAt) }] : []),
        ...(ctx.lastCompactAt ? [{ k: 'Last compaction', v: `${fmtSpan(c.at - ctx.lastCompactAt)} ago` }] : []),
      ],
    })
  }
  if (!b) return [...blocks, { t: 'note', text: 'No breakdown yet.' }, { t: 'buttons', buttons: [refresh('ctx-refresh', c.a.refreshBreakdown)] }]
  const usedCats = b.categories.filter(x => x.kind !== 'free')
  const servers = [...b.mcpTools.reduce((m, t) => m.set(t.server, (m.get(t.server) ?? 0) + t.tokens), new Map<string, number>())]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((x, y) => y.tokens - x.tokens)
  return [
    ...blocks,
    section(
      c,
      'ctx-breakdown',
      'Breakdown',
      [
        {
          t: 'stack',
          total: ctx.tokens,
          max: ctx.window || usedCats.reduce((n, x) => n + x.tokens, 0),
          segs: usedCats.map(x => ({ name: x.name, value: fmtTokens(x.tokens), tokens: x.tokens, color: x.color.startsWith('#') ? x.color : C.grey })),
        },
      ],
      { note: `${fmtSpan(c.at - b.at)} ago` },
    ),
    ...(b.memoryFiles.length ? [section(c, 'ctx-memory', 'Memory files', [{ t: 'bars', rows: top(b.memoryFiles, m => baseName(m.path), C.blue) }], { note: String(b.memoryFiles.length), open: false })] : []),
    ...(servers.length ? [section(c, 'ctx-mcp', 'MCP tools by server', [{ t: 'bars', rows: top(servers, s => s.name, C.accent) }], { note: String(servers.length), open: false })] : []),
    ...(b.skills.length ? [section(c, 'ctx-skills', 'Skills', [{ t: 'bars', rows: top(b.skills, s => s.name, C.yellow) }], { note: String(b.skills.length), open: false })] : []),
    { t: 'buttons', buttons: [refresh('ctx-refresh', c.a.refreshBreakdown)] },
  ]
}

/** File rows, each with its own ▸ diff; `tint` colours the status chip (uncommitted rows are orange). */
const fileRows = (c: Ctx, list: FileChange[], scope: 'wt' | 'br', against: string, touched: Set<string>, tint?: string): Block[] =>
  list.flatMap(f => {
    const key = `file:${scope}:${f.path}`
    const isOpen = c.expanded.includes(key)
    const diff = c.d.diffs.find(d => d.path === f.path && d.against === against)
    const row: Block = {
      t: 'file',
      ...f,
      isTouched: touched.has(f.path),
      isOpen,
      toggle: c.a.toggle(key, isOpen, () => c.a.loadDiff(f.path, f.status, against)),
      ...(tint ? { tint } : {}),
    }
    if (!isOpen) return [row]
    return [row, diff ? { t: 'code' as const, source: diff.patch, path: f.path } : { t: 'note' as const, text: 'Loading the diff…' }]
  })

const sums = (files: FileChange[]) => ({ added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) })

const changes = (c: Ctx): Block[] => {
  const ch = c.d.changes
  const buttons: Block = { t: 'buttons', buttons: [refresh('changes-refresh', c.a.refreshChanges)] }
  if (ch.error) return [{ t: 'note', text: ch.error }, buttons]
  const touched = new Set(ch.touched)
  const wt = sums(ch.files)
  const br = sums(ch.branchFiles)
  const byTouched = [...ch.files].sort((x, y) => Number(touched.has(y.path)) - Number(touched.has(x.path)))
  const baseName_ = ch.base?.replace(/^origin\//, '') ?? ''
  return [
    {
      t: 'tiles',
      rows: [
        ch.base ? { k: `vs ${baseName_}`, v: '', spans: plusMinus(br.added, br.removed) } : { k: 'Branch', v: '—' },
        { k: 'Uncommitted', v: '', spans: plusMinus(wt.added, wt.removed), accent: C.orange },
        { k: 'This session', v: files(touched.size), color: touched.size ? C.accent : undefined },
      ],
    },
    section(c, 'chg-wt', 'Uncommitted', ch.files.length ? fileRows(c, byTouched, 'wt', 'HEAD', touched, C.orange) : [{ t: 'note', text: 'Nothing uncommitted: the working tree is clean.' }], {
      note: `${files(ch.files.length)}${touched.size ? ' · ● edited here' : ''}`,
    }),
    ...(ch.base
      ? [
          section(c, 'chg-br', 'On this branch', fileRows(c, ch.branchFiles, 'br', ch.base, touched), {
            note: `vs ${baseName_} · ${files(ch.branchFiles.length)}`,
          }),
        ]
      : []),
    { t: 'note', text: ch.at ? `Checked ${ago(c.at - ch.at)}` : 'Not checked yet' },
    buttons,
  ]
}

const agentsTab = (c: Ctx): Block[] => {
  const list = c.d.agents
  const running = list.filter(a => a.status === 'running').reverse()
  const finished = list.filter(a => a.status !== 'running').reverse()
  const spent = list.reduce((n, a) => n + a.costUsd, 0)
  const blocks: Block[] = [
    {
      t: 'tiles',
      rows: [
        { k: 'Running', v: String(running.length), color: running.length ? C.accent : undefined },
        { k: 'Finished', v: String(finished.length) },
        { k: 'Agent spend', v: `≈${fmtCost(spent)}` },
      ],
    },
  ]
  const rows: Block[] = running.map(run => {
    const key = `agent:${run.id}`
    const isOpen = c.expanded.includes(key)
    return { t: 'agent', run, at: c.at, isOpen, toggle: c.a.toggle(key, isOpen) }
  })
  blocks.push(section(c, 'agents-running', 'Running', rows.length ? rows : [{ t: 'note', text: 'No agents running.' }], { note: String(running.length) }))
  if (finished.length) {
    const max = Math.max(0.0001, ...finished.map(r => r.costUsd))
    blocks.push(
      section(
        c,
        'agents-finished',
        'Finished this session',
        [
          {
            t: 'bars',
            rows: finished.slice(0, 20).map(r => ({
              label: `${r.status === 'failed' ? '✗ ' : ''}${r.description || r.type}`,
              value: `≈${fmtCost(r.costUsd)}`,
              ratio: r.costUsd / max,
              color: r.status === 'failed' ? C.red : C.grey,
            })),
          },
        ],
        { note: String(finished.length), open: false },
      ),
    )
  }
  return blocks
}

/** `mcp__server__tool` → `server · tool`. */
const toolLabel = (name: string): string => {
  const server = serverOf(name)
  return server ? `${server} · ${name.slice(`mcp__${server}__`.length)}` : name
}

const toolsTab = (c: Ctx): Block[] => {
  const t = c.d.tools
  const calls = t.stats.reduce((n, s) => n + s.calls, 0)
  const errors = t.stats.reduce((n, s) => n + s.errors, 0)
  const total = t.stats.reduce((n, s) => n + s.totalMs, 0)
  const blocks: Block[] = [
    {
      t: 'tiles',
      rows: [
        { k: 'Tool calls', v: String(calls) },
        { k: 'Errors', v: String(errors), color: errors ? C.red : undefined },
        { k: 'Time in tools', v: fmtMs(total) },
      ],
    },
  ]
  if (t.stats.length) {
    const top = [...t.stats].sort((a, b) => b.calls - a.calls).slice(0, 10)
    const max = Math.max(1, ...top.map(s => s.calls))
    blocks.push(
      section(c, 'tools-top', 'Most used', [
        {
          t: 'bars',
          rows: top.map(s => ({
            label: toolLabel(s.name),
            value: `${s.calls}× · ${fmtMs(s.totalMs / s.calls)}${s.errors ? ` · ${s.errors}✗` : ''}`,
            ratio: s.calls / max,
            color: s.errors ? C.red : C.accent,
          })),
        },
      ], { note: `${t.stats.length} tools` }),
    )
  }
  if (t.mcp.length) {
    const max = Math.max(1, ...t.mcp.map(m => m.tools))
    const used = (server: string) => t.stats.filter(s => serverOf(s.name) === server).reduce((n, s) => n + s.calls, 0)
    blocks.push(
      section(c, 'tools-mcp', 'MCP servers', [{ t: 'bars', rows: t.mcp.map(m => ({ label: m.name, value: `${m.tools} tools · ${used(m.name)} calls`, ratio: m.tools / max, color: C.blue })) }], {
        note: String(t.mcp.length),
        open: false,
      }),
    )
  }
  if (t.recent.length) {
    blocks.push(
      section(
        c,
        'tools-recent',
        'Recent calls',
        [
          {
            t: 'kv',
            rows: [...t.recent]
              .reverse()
              .slice(0, 15)
              .map(r => ({ k: toolLabel(r.name), v: `${r.isError ? '✗ ' : ''}${fmtMs(r.ms)} · ${fmtSpan(c.at - r.at)} ago`, color: r.isError ? C.red : undefined })),
          },
        ],
        { open: false },
      ),
    )
  }
  blocks.push({ t: 'buttons', buttons: [refresh('tools-refresh', c.a.refreshMcp)] })
  return blocks
}

const configTab = (c: Ctx): Block[] => {
  const { config: cfg, env, breakdown: b } = c.d
  const buttons: Block = { t: 'buttons', buttons: [refresh('config-refresh', c.a.refreshConfig)] }
  if (!cfg) return [{ t: 'note', text: 'Reading the configuration…' }, buttons]
  const maxChars = Math.max(1, ...cfg.memory.map(m => m.chars))
  return [
    {
      t: 'tiles',
      rows: [
        { k: 'Memory files', v: String(cfg.memory.length) },
        { k: 'Plugins', v: String(cfg.plugins.length) },
        { k: 'Hooks', v: String(cfg.hooks) },
      ],
    },
    section(
      c,
      'cfg-perms',
      'Permissions',
      [
        {
          t: 'kv',
          rows: [
            { k: 'Mode', v: env?.permissionMode ?? cfg.permissions.defaultMode ?? 'default' },
            { k: 'Allow rules', v: String(cfg.permissions.allow), color: C.green },
            { k: 'Ask rules', v: String(cfg.permissions.ask), color: C.yellow },
            { k: 'Deny rules', v: String(cfg.permissions.deny), color: C.red },
            { k: 'Slash commands', v: String(cfg.commands) },
          ],
        },
      ],
    ),
    section(
      c,
      'cfg-memory',
      'Memory',
      cfg.memory.length
        ? [{ t: 'bars', rows: cfg.memory.map(m => ({ label: m.path, value: `~${fmtTokens(m.chars / 4)}`, ratio: m.chars / maxChars, color: C.blue })) }]
        : [{ t: 'note', text: 'No CLAUDE.md or AGENTS.md found.' }],
      { note: String(cfg.memory.length) },
    ),
    section(
      c,
      'cfg-plugins',
      'Plugins',
      cfg.plugins.length ? [{ t: 'kv', rows: cfg.plugins.map(p => ({ k: p.name, v: p.commands ? `${p.commands} commands` : 'enabled' })) }] : [{ t: 'note', text: 'No plugins.' }],
      { note: String(cfg.plugins.length), open: false },
    ),
    ...(b?.skills.length
      ? [section(c, 'cfg-skills', 'Skills', [{ t: 'kv', rows: b.skills.map(s => ({ k: s.name, v: `~${fmtTokens(s.tokens)}` })) }], { note: String(b.skills.length), open: false })]
      : []),
    buttons,
  ]
}

export const BUILD: Record<Tab, (ctx: Ctx) => Block[]> = {
  overview,
  context,
  changes,
  agents: agentsTab,
  tools: toolsTab,
  config: configTab,
}
