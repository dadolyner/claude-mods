import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Changes, Config, ContextInfo, FileChange, Tab, Tools, UsageInfo } from '../types'
import { HEADER_H, headerSvg } from './draw/svg'
import { baseName, modelName, windowOf } from './format'
import {
  CHANGERS,
  EDITORS,
  EMPTY_CHANGES,
  MAX_DIFFS,
  MAX_UNTRACKED,
  MEMORY_NAMES,
  addCall,
  addSpend,
  branchFilesOf,
  breakdownOf,
  clipPatch,
  completeRun,
  configOf,
  mcpServers,
  parseStatus,
  parseWc,
  relative,
  reportStep,
  spawnRun,
  stepRun,
  windowsOf,
  withLines,
} from './model'
import { renderBlocks } from './render'
import type { Actions, Data } from './tabs'
import { BUILD, TABS } from './tabs'

// A sidebar of everything about the running session, one tab per topic. The hooks
// here keep the state current from the engine's events (the mod API follows `$` only
// within one file, so every engine call lives here); model.ts holds the pure
// reducers, tabs.ts turns state into blocks, render.tsx draws them per surface.

const PANE = 'session-hub'
const TITLE = 'Session'
const TICK_MS = 5000
// the agents mod's worker step reports, read here too for the agents' own progress.
const STEP_TOOL = 'mcp__agents__step'

// Every value the hub keeps. Bump a `shape` tag when that value's fields change:
// what an earlier version stored then reads as the initial value.

const tabAtom = atom({ plugin: 'session-hub', key: 'tab' } as const, 'overview' as const, { shape: 'tab-2' })
const expandedAtom = atom({ plugin: 'session-hub', key: 'expanded' } as const, [], { shape: 'expanded-1' })
const nowAtom = atom({ plugin: 'session-hub', key: 'now' } as const, 0)
const envAtom = atom({ plugin: 'session-hub', key: 'env' } as const, null, { shape: 'env-1' })
const contextAtom = atom({ plugin: 'session-hub', key: 'context' } as const, { tokens: 0, window: 0, compactions: 0, lastCompactAt: null } as ContextInfo, {
  shape: 'context-1',
})
const breakdownAtom = atom({ plugin: 'session-hub', key: 'breakdown' } as const, null, { shape: 'breakdown-1' })
const changesAtom = atom({ plugin: 'session-hub', key: 'changes' } as const, { at: 0, branch: null, files: [], base: null, branchFiles: [], touched: [], error: null } as Changes, {
  shape: 'changes-2',
})
const diffsAtom = atom({ plugin: 'session-hub', key: 'diffs' } as const, [], { shape: 'diffs-2' })
const agentsAtom = atom({ plugin: 'session-hub', key: 'agents' } as const, [], { shape: 'agents-1' })
const toolsAtom = atom({ plugin: 'session-hub', key: 'tools' } as const, { stats: [], recent: [], mcp: [] } as Tools, { shape: 'tools-1' })
const usageAtom = atom({ plugin: 'session-hub', key: 'usage' } as const, { startedAt: 0, cost: null, windows: [], lastMainAt: 0, byModel: [] } as UsageInfo, {
  shape: 'usage-1',
})
const configAtom = atom({ plugin: 'session-hub', key: 'config' } as const, null as Config | null, { shape: 'config-1' })

const isTab = (v: string): v is Tab => TABS.some(t => t.id === v)

// ---- reading the engine ----

/** Runs a command and answers its result, or null when it could not run. */
const run = async ($: EngineInterface, argv: string[], cwd?: string) => {
  try {
    return await $.process.run(argv, { cwd, timeoutMs: 10_000 })
  } catch {
    return null
  }
}

const refreshEnv = async ($: EngineInterface): Promise<void> => {
  const [cwd, root, repo, model, version, sessionId] = await Promise.all([
    $.session.cwd(),
    $.session.root(),
    $.session.repo().catch(() => null),
    $.session.model(),
    $.session.version().catch(() => ({ version: '' })),
    $.session.id(),
  ])
  const [branch, os] = await Promise.all([run($, ['git', 'branch', '--show-current'], cwd), run($, ['uname', '-sr'])])
  await update($, envAtom, prev => ({
    cwd,
    root,
    project: baseName(repo?.root ?? root),
    branch: branch?.exitCode === 0 ? branch.stdout.trim() || null : null,
    remote: repo?.remote ?? null,
    model,
    effort: prev?.effort ?? null,
    permissionMode: prev?.permissionMode ?? null,
    version: version.version,
    os: os?.exitCode === 0 ? os.stdout.trim() : '',
    sessionId,
  }))
}

const refreshUsage = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, usageAtom, prev => ({ ...prev, startedAt: u.startedAt, cost: u.cost?.usd ?? prev.cost, windows: windowsOf(u.rateLimits) }))
  const { tokens, window } = u.context
  await update($, contextAtom, prev => ({ ...prev, tokens: tokens && tokens > 0 ? tokens : prev.tokens, window: window || prev.window }))
}

// The context's breakdown, as /context counts it. `summary` estimates locally and
// sends no requests; taken on demand (opening the tab, Refresh), never while drawing.
const refreshBreakdown = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  if (!b) return
  const at = await $.clock.now()
  await update($, breakdownAtom, () => breakdownOf(b, at))
  if (b.totalTokens > 0) await update($, contextAtom, prev => ({ ...prev, tokens: b.totalTokens, window: b.maxTokens || prev.window }))
}

/** The default branch to compare with: origin's HEAD, else origin/main or origin/master. */
const defaultBranch = async ($: EngineInterface, root: string): Promise<string | null> => {
  const head = await run($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root)
  if (head?.exitCode === 0 && head.stdout.trim()) return head.stdout.trim()
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    const r = await run($, ['git', 'rev-parse', '--verify', '--quiet', name], root)
    if (r?.exitCode === 0) return name
  }
  return null
}

const refreshChanges = async ($: EngineInterface): Promise<void> => {
  const root = await $.session.root()
  const at = await $.clock.now()
  const status = await run($, ['git', 'status', '--porcelain=v1', '-b', '-uall'], root)
  if (!status || status.exitCode !== 0) {
    await update($, changesAtom, prev => ({ ...prev, at, files: [], branchFiles: [], base: null, error: 'Not a git repository' }))
    return
  }
  const numstat = await run($, ['git', 'diff', '--numstat', 'HEAD'], root)
  const parsed = parseStatus(status.stdout, numstat?.exitCode === 0 ? numstat.stdout : '')
  // git's numstat leaves out untracked files: count their lines in one `wc` call.
  const untracked = parsed.files.filter(f => f.status === '?').slice(0, MAX_UNTRACKED)
  const wc = untracked.length ? await run($, ['wc', '-l', ...untracked.map(f => f.path)], root) : null
  const files = withLines(parsed.files, parseWc(wc?.stdout ?? ''))
  // The branch since it left the default branch, as the app's Changes panel counts it.
  const base = parsed.branch ? await defaultBranch($, root) : null
  const mergeBase = base ? await run($, ['git', 'merge-base', 'HEAD', base], root) : null
  const since = mergeBase?.exitCode === 0 ? mergeBase.stdout.trim() : null
  let branchFiles: FileChange[] = []
  if (since) {
    const [branchStat, names] = await Promise.all([
      run($, ['git', 'diff', '--numstat', since], root),
      run($, ['git', 'diff', '--name-status', since], root),
    ])
    branchFiles = branchFilesOf(branchStat?.stdout ?? '', names?.stdout ?? '', files.filter(f => f.status === '?'))
  }
  await update($, changesAtom, prev => ({ ...prev, at, branch: parsed.branch, files, base: since ? base : null, branchFiles, error: null }))
  // A cached diff is stale once the tree moved.
  await update($, diffsAtom, () => [])
}

/** One file's diff against HEAD or the branch's merge base; an untracked file diffs against nothing. */
const loadDiff = async ($: EngineInterface, path: string, status: string, against: string): Promise<void> => {
  const root = await $.session.root()
  let ref = against
  if (against !== 'HEAD') {
    const mb = await run($, ['git', 'merge-base', 'HEAD', against], root)
    ref = mb?.exitCode === 0 ? mb.stdout.trim() : 'HEAD'
  }
  const r =
    status === '?' ? await run($, ['git', 'diff', '--no-index', '--', '/dev/null', path], root) : await run($, ['git', 'diff', ref, '--', path], root)
  // `--no-index` exits 1 when the files differ, which is the point.
  const patch = clipPatch(r && r.exitCode <= 1 ? r.stdout : '')
  await update($, diffsAtom, list => [...list.filter(d => d.path !== path || d.against !== against), { path, against, patch }].slice(-MAX_DIFFS))
}

const refreshMcp = async ($: EngineInterface): Promise<void> => {
  const mcp = mcpServers(await $.tool.list())
  await update($, toolsAtom, prev => ({ ...prev, mcp }))
}

const refreshConfig = async ($: EngineInterface): Promise<void> => {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const [project, user, commands, settings] = await Promise.all([
    $.fs.ancestors({ names: MEMORY_NAMES, of: cwd }).catch(() => []),
    home ? $.fs.ancestors({ names: ['CLAUDE.md'], of: `${home}/.claude/settings.json` }).catch(() => []) : Promise.resolve([]),
    $.command.list().catch(() => []),
    $.settings.read().catch(() => ({})),
  ])
  const at = await $.clock.now()
  await update($, configAtom, () => configOf([...user, ...project], commands, settings as Record<string, unknown>, home, at))
}

// One pending working-tree refresh at a time: a burst of edits refreshes once.
let pending: { cancel: () => void } | null = null

const scheduleChanges = ($: EngineInterface): void => {
  pending?.cancel()
  pending = $.clock.after(1000, () => {
    pending = null
    void refreshChanges($).catch(() => undefined)
  })
}

/** Switches tab and fetches what that tab shows fresh. */
const showTab = async ($: EngineInterface, tab: Tab): Promise<void> => {
  await update($, tabAtom, () => tab)
  try {
    if (tab === 'context') await refreshBreakdown($)
    else if (tab === 'changes') await refreshChanges($)
    else if (tab === 'tools') await refreshMcp($)
    else if (tab === 'config') await refreshConfig($)
  } catch {
    // A failed refresh leaves the last figures shown.
  }
}

const actionsOf = ($: EngineInterface): Actions => ({
  toggle: (key, isOpen, onOpen) => ({
    key,
    label: isOpen ? '▾' : '▸',
    onPress: async () => {
      await update($, expandedAtom, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key].slice(-50)))
      if (!isOpen && onOpen) await onOpen()
    },
  }),
  refreshBreakdown: () => refreshBreakdown($),
  refreshChanges: () => refreshChanges($),
  refreshMcp: () => refreshMcp($),
  refreshConfig: () => refreshConfig($),
  loadDiff: (path, status, against) => loadDiff($, path, status, against),
})

// ---- hooks ----

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hub',
      description: 'Show or hide the session sidebar; /hub <tab> opens a tab',
      argumentHint: '[overview|context|changes|agents|tools|config]',
    })
    // A failing source leaves its tab empty, never the session.
    await Promise.all([refreshEnv($), refreshUsage($), refreshChanges($), refreshMcp($), refreshConfig($)].map(p => p.catch(() => undefined)))
    // Keeps ages and running agents current, only while the pane is shown.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const shown = (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
        if (!shown) return
        const at = await $.clock.now()
        await update($, nowAtom, () => at)
      })()
    })
    if (options.autoOpen !== 'off') void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'hub' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg && !isTab(arg)) return { text: `Unknown tab "${arg}". Tabs: ${TABS.map(t => t.id).join(', ')}.` }
    if (arg && isTab(arg)) {
      await showTab($, arg)
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: `Session hub: ${arg}.` }
    }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Session hub closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Session hub opened.' }
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const r = await next(e)
    await refreshEnv($)
    return r
  }).catch(($, e, next) => next(e))

  // Only the classic hook inputs carry the permission mode.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const r = await next(e)
    const mode = e.permission_mode
    if (typeof mode === 'string') await update($, envAtom, prev => (prev && prev.permissionMode !== mode ? { ...prev, permissionMode: mode } : prev))
    return r
  }).catch(($, e, next) => next(e))

  // /clear starts the session's figures over.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear') {
      await update($, usageAtom, prev => ({ ...prev, byModel: [], lastMainAt: 0 }))
      await update($, contextAtom, () => ({ tokens: 0, window: 0, compactions: 0, lastCompactAt: null }))
      await update($, breakdownAtom, () => null)
      await update($, changesAtom, prev => ({ ...EMPTY_CHANGES, branch: prev.branch, files: prev.files, at: prev.at }))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, usageAtom, prev => ({ ...prev, windows: windowsOf(e.rateLimits) }))
    if (e.changed.includes('cost') && e.cost) {
      const usd = e.cost.usd
      await update($, usageAtom, prev => ({ ...prev, cost: usd }))
    }
    const tokens = e.context.tokens
    if (e.changed.includes('context') && tokens && tokens > 0) {
      await update($, contextAtom, prev => ({ ...prev, tokens, window: e.context.window || prev.window }))
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') {
      const at = await $.clock.now()
      await update($, contextAtom, prev => ({ ...prev, compactions: prev.compactions + 1, lastCompactAt: at }))
    }
    return r
  })

  // Every model request: the main thread's model and effort, spend by model, the
  // cache clock, and a subagent's live figures.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    const at = await $.clock.now()
    const model = u?.model || e.model
    const effort = typeof e.effort === 'string' ? e.effort : undefined
    if (!e.agentId) {
      await update($, envAtom, prev => (prev && (prev.model !== e.model || prev.effort !== (effort ?? null)) ? { ...prev, model: e.model, effort: effort ?? null } : prev))
    }
    await update($, usageAtom, prev => ({
      ...prev,
      lastMainAt: e.agentId ? prev.lastMainAt : at,
      byModel: u ? addSpend(prev.byModel, model, u) : prev.byModel,
    }))
    const agentId = e.agentId
    if (agentId && u) await update($, agentsAtom, list => stepRun(list, agentId, model, effort, u))
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    const runRec: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      contextMax: windowOf(started.model),
      tokens: 0,
      costUsd: 0,
      steps: 0,
    }
    await update($, agentsAtom, list => spawnRun(list, runRec))
    await update($, nowAtom, () => at)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const agentId = e.agentId
    if (!agentId) return r
    const at = await $.clock.now()
    await update($, agentsAtom, list => completeRun(list, agentId, e.reason === 'answer', at, e.usage))
    await update($, nowAtom, () => at)
    return r
  })

  // Every tool call: its count and time, and whether the working tree may have moved.
  on('tool.call', async ($, e, next) => {
    const t0 = await $.clock.now()
    const r = await next(e)
    const at = await $.clock.now()
    const isError = r.deny !== undefined || ('isError' in r && r.isError === true)
    await update($, toolsAtom, prev => addCall(prev, e.tool, Math.max(0, at - t0), isError, at))
    if (CHANGERS.has(e.tool)) {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      const file = input.file_path ?? input.notebook_path
      if (EDITORS.has(e.tool) && r.deny === undefined && file) {
        const rel = relative(file, await $.session.root())
        await update($, changesAtom, c => (c.touched.includes(rel) ? c : { ...c, touched: [...c.touched, rel].slice(-200) }))
      }
      scheduleChanges($)
    }
    return r
  })

  on('tool.call', { tool: STEP_TOOL }, async ($, e, next) => {
    const r = await next(e)
    const agentId = e.agentId
    if (agentId) await update($, agentsAtom, list => reportStep(list, agentId, e as unknown as { done?: number; total?: number; note?: string }))
    return r
  })

  // ---- the pane ----

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui
    // Reading `now` subscribes the drawing to the tick.
    const [tab, expanded, env, context, breakdown, changes, diffs, agents, tools, usage, config] = await Promise.all([
      read($, tabAtom),
      read($, expandedAtom),
      read($, envAtom),
      read($, contextAtom),
      read($, breakdownAtom),
      read($, changesAtom),
      read($, diffsAtom),
      read($, agentsAtom),
      read($, toolsAtom),
      read($, usageAtom),
      read($, configAtom),
      read($, nowAtom),
    ])
    const d: Data = { env, context, breakdown, changes, diffs, agents, tools, usage, config }
    const at = await $.clock.now()
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const W = Math.max(240, Math.min(900, cols * 8 - 8))
    const blocks = BUILD[tab]({ d, a: actionsOf($), at, expanded })

    const model = env ? modelName(env.model) : ''
    const branch = changes.branch ?? env?.branch ?? null
    const title = [env?.project ?? 'Session', branch, model].filter(Boolean).join(' · ')
    const header =
      hasSvg && 'Svg' in ui ? (
        <ui.Svg key="header" source={headerSvg(W, env?.project ?? 'Session', branch, model, agents.some(a => a.status === 'running'))} alt={title} width={W} height={HEADER_H} />
      ) : (
        <Text key="header" bold wrap="truncate-end">
          {title}
        </Text>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Box key="tabs" flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
          {/* A desktop draws a Button's label, never its children: the label is the icon. */}
          {TABS.map(t => (
            <Button key={`tab-${t.id}`} label={t.icon} variant={t.id === tab ? 'primary' : 'secondary'} dimColor={t.id !== tab} onPress={() => void showTab($, t.id)} />
          ))}
        </Box>
        <Box key="body" flexDirection="column" gap={1}>
          {renderBlocks(ui, hasSvg, W, cols, blocks)}
        </Box>
      </Box>
    )
  })
}
