import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { branchFilesOf, parseStatus, parseWc, withLines, windowsOf } from '../hooks/model'

const PLUGIN = 'session-hub'
const NOW = Date.parse('2026-10-28T10:00:00Z')
const pane = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'session-hub',
    props: { title: 'Session', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const PORCELAIN = '## main...origin/main\n M hooks/register.tsx\n?? notes.md\n'
const NUMSTAT = '12\t3\thooks/register.tsx\n'
const BRANCH_NUMSTAT = '100\t5\tsrc/a.ts\n12\t3\thooks/register.tsx\n'

// Stands in for the engine: every `$` call the hub makes at start, and git.
async function boot($: Engine, on: On, isOpenStubbed = true) {
  mock.clock(on, { now: NOW })
  if (isOpenStubbed) on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'hub' } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: 'git@github.com:me/repo.git', internal: false, name: 'repo' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.309' } }))
  on('session.id', () => ({ value: 'abcdef1234' }))
  on('session.usage', () => ({
    value: { startedAt: NOW - 65 * 60000, context: { tokens: 250_000, window: 1_000_000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 30 }, { kind: 'five_hour', percentUsed: 40 }], cost: { usd: 3.5 } },
  }))
  on('tool.list', () => ({ value: [{ name: 'mcp__slack__send', description: '', mcp: true }, { name: 'Bash', description: '', mcp: false }] }))
  on('command.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: { permissions: { allow: ['Bash(ls)'], deny: [] } } }))
  on('fs.ancestors', () => ({ value: [] }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv.join(' ')
    const stdout =
      [
        ['git status', PORCELAIN],
        ['git diff --numstat HEAD', NUMSTAT],
        ['git diff --numstat abc123', BRANCH_NUMSTAT],
        ['git diff --name-status abc123', 'M\tsrc/a.ts\nM\thooks/register.tsx\n'],
        ['git symbolic-ref', 'origin/master\n'],
        ['git merge-base', 'abc123\n'],
        ['git branch', 'main\n'],
        ['git diff HEAD', '@@ -1 +1 @@\n-old\n+new\n'],
        ['wc -l', '       7 notes.md\n'],
      ].find(([cmd]) => argv.startsWith(cmd!))?.[1] ?? 'Darwin 27.0.0'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
}

test('model: git status and numstat become the changed files', () => {
  expect(parseStatus(PORCELAIN, NUMSTAT)).toEqual({
    branch: 'main',
    files: [
      { path: 'hooks/register.tsx', status: 'M', added: 12, removed: 3 },
      { path: 'notes.md', status: '?', added: 0, removed: 0 },
    ],
  })
})

test('model: untracked files get their line counts; the branch list adds them, biggest first', () => {
  const files = withLines(parseStatus(PORCELAIN, NUMSTAT).files, parseWc('       7 notes.md\n      7 total\n'))
  expect(files.find(f => f.path === 'notes.md')?.added).toBe(7)
  const branch = branchFilesOf(BRANCH_NUMSTAT, 'M\tsrc/a.ts\n', files.filter(f => f.status === '?'))
  expect(branch.map(f => [f.path, f.added, f.removed])).toEqual([
    ['src/a.ts', 100, 5],
    ['hooks/register.tsx', 12, 3],
    ['notes.md', 7, 0],
  ])
})

test('model: the 5-hour window comes before the 7-day one', () => {
  expect(windowsOf([{ kind: 'seven_day', percentUsed: 1 }, { kind: 'five_hour', percentUsed: 2 }]).map(w => w.kind)).toEqual(['five_hour', 'seven_day'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane shows the tab bar and the overview`, async ($, on) => {
    await boot($, on)
    const ui = await $.ui.mount(pane(surface))
    for (const id of ['overview', 'context', 'changes', 'agents', 'tools', 'config']) {
      expect(await ui.find({ key: `tab-${id}` })).toBeDefined()
    }
    expect((await ui.find({ key: 'tab-overview' }))?.props.variant).toBe('primary')
    const drawn = JSON.stringify(await ui.findAll({}))
    expect(drawn).toContain('repo')
    expect(drawn).toContain('main')
    expect(drawn).toContain('Opus 5.5')
    await ui.unmount()
  })

  test(`${surface}: the Changes tab lists git's files and expands a diff`, async ($, on) => {
    await boot($, on)
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab-changes' })
    expect((await ui.find({ key: 'tab-changes' }))?.props.variant).toBe('primary')
    let drawn = JSON.stringify(await ui.findAll({}))
    // Branch vs master counts what the app's Changes panel does; uncommitted counts the new file's lines.
    expect(drawn).toContain('+119 ')
    expect(drawn).toContain('−8')
    expect(drawn).toContain('+19 ')
    expect(drawn).toContain('#3B9C5F')
    expect(drawn).toContain('#D0453F')
    expect(drawn).toContain('hooks/register.tsx')
    expect(drawn).toContain('notes.md')
    // Every file shows, the branch's as well.
    expect(drawn).toContain('src/a.ts')
    await ui.press({ key: 'sec:chg-br' })
    drawn = JSON.stringify(await ui.findAll({}))
    expect(drawn).not.toContain('src/a.ts')
    await ui.press({ key: 'file:wt:hooks/register.tsx' })
    const code = await ui.find({ type: 'Code' })
    expect(String(code?.props.source)).toContain('+new')
    await ui.unmount()
  })

  test(`${surface}: Agents shows a running agent until its turn completes`, async ($, on) => {
    // Hooks beneath the plugins are registered before the first `$` call.
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
    on('turn.complete', () => ({ text: '' }) as never)
    await boot($, on)
    await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Map the auth flow', subagentType: 'researcher', provider: 'engine', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab-agents' })
    expect(JSON.stringify(await ui.findAll({}))).toContain('Map the auth flow')
    expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
    await ui.unmount()

    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't' })
    const after = await $.ui.mount(pane(surface))
    expect(await after.find({ key: 'agent:a1' })).toBeUndefined()
    expect(JSON.stringify(await after.findAll({}))).toContain('Finished this session')
    await after.unmount()
  })

  test(`${surface}: Tools counts calls and lists MCP servers`, async ($, on) => {
    await boot($, on)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pwd' } as never)
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab-tools' })
    const drawn = JSON.stringify(await ui.findAll({}))
    expect(drawn).toContain('2×')
    expect(await ui.find({ key: 'sec:tools-mcp' })).toBeDefined()
    await ui.unmount()
  })
}

test('/hub <tab> opens the pane on that tab; an unknown tab is refused', async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } }
  })
  await boot($, on, false)
  expect(await $.command.run({ command: 'hub', args: 'tools' } as never)).toMatchObject({ text: 'Session hub: tools.' })
  expect(opened).toContain('session-hub')
  expect(await $.command.run({ command: 'hub', args: 'todos' } as never)).toMatchObject({ text: expect.stringContaining('Unknown tab') })
})
