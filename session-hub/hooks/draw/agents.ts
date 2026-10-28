// Agent rows: a pixel crab in its role's costume, the task, model and progress.
// Ported from the agents mod (mods cannot import each other).

import type { AgentRun } from '../../types'
import { fmtCost, fmtTime, fmtTokens, modelName, pct } from '../format'
import { fitText, svg, text, xml } from './svg'

export type Role = 'research' | 'dev' | 'review' | 'plan' | 'test' | 'write'

export const ROLE_COLOR: Record<Role, string> = {
  research: '#378ADD',
  dev: '#1D9E75',
  review: '#D85A30',
  plan: '#BA7517',
  test: '#7F77DD',
  write: '#C2588F',
}

export const ROLE_WORD: Record<Role, string> = {
  research: 'Researcher',
  dev: 'Developer',
  review: 'Reviewer',
  plan: 'Architect',
  test: 'Tester',
  write: 'Writer',
}

// The role subagents in ~/.claude/agents, and the built-ins, by name; a plugin prefix is ignored.
const ROLE_BY_TYPE: Record<string, Role> = {
  researcher: 'research',
  developer: 'dev',
  reviewer: 'review',
  architect: 'plan',
  tester: 'test',
  writer: 'write',
  explore: 'research',
  plan: 'plan',
}

// First match wins: "spec review" is a review, not a test.
const ROLE_RULES: [RegExp, Role][] = [
  [/review|audit|verif|critique/i, 'review'],
  [/\btests?\b|testing|\bqa\b/i, 'test'],
  [/\bdocs?\b|document|write-?up|summar|readme|report/i, 'write'],
  [/\bplan|design|architect/i, 'plan'],
  [/research|investigat|explor|search|find|look ?up|count|list|analy|read/i, 'research'],
]

export const roleOf = (a: Pick<AgentRun, 'type' | 'description'>): Role =>
  ROLE_BY_TYPE[a.type.replace(/^[^:]*:/, '').toLowerCase()] ?? ROLE_RULES.find(([re]) => re.test(`${a.type} ${a.description}`))?.[1] ?? 'dev'

export const runModel = (a: AgentRun): string => (a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model))

export const progressOf = (a: AgentRun): number | null => (a.stepTotal ? Math.min(1, (a.stepDone ?? 0) / a.stepTotal) : null)

export const ctxOf = (a: AgentRun): number => pct(a.contextTokens, a.contextMax)

/** Reported steps as a percent, else the context fill. */
export const progressText = (a: AgentRun): string => {
  const p = progressOf(a)
  return p === null ? `ctx ${ctxOf(a)}%` : `${Math.round(p * 100)}%`
}

export const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

export const statsOf = (a: AgentRun, at: number): [label: string, value: string][] => [
  ['Tokens', fmtTokens(a.tokens)],
  ['Cost', '≈' + fmtCost(a.costUsd)],
  ['Time', fmtTime(elapsed(a, at))],
  ['Context', `${ctxOf(a)}% · ${fmtTokens(a.contextTokens)}`],
  ['Requests', String(a.steps)],
  ['Type', a.type],
]

// ---- the crab: Pixel Clawd on a 30×28 grid, one costume per role ----

const CLAY = '#D97757'
const INK = '#1F1E1D'
const PAPER = '#F8F6F1'
const LINE = '#B9B6AE'

type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
@keyframes blink{50%{opacity:.15}}
.c-research.run .pg{transform-origin:0 50%;animation:page 1s steps(1) infinite}
@keyframes page{50%{transform:scaleX(-1)}}
.c-dev.run .cd{animation:blink 1s steps(1) infinite}.c-dev.run .cd2{animation:blink 1s steps(1) infinite -.5s}
.c-dev.run .cur{animation:blink .5s steps(1) infinite}
.c-review.run .it{animation:scan 1s steps(1) infinite}.c-review.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-plan.run .it,.c-write.run .it{animation:scan 1s steps(1) infinite}
.c-test.run .bub{animation:rise 1s steps(2) infinite}.c-test.run .bub2{animation:rise 1s steps(2) infinite -.5s}
@keyframes rise{100%{transform:translateY(-2px);opacity:0}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<Role, (f: Fill, t: string) => void> = {
  research: (f, t) => {
    crabBody(f)
    stamp(f, 8, 11, ['kkkk......kkkk', 'k..kkkkkkkk..k', 'k..k......k..k', 'kkkk......kkkk'], { k: '#3A3A3C' })
    stamp(f, 8, 16, ['.wwwwwbwwwww.', 'wllllwbwlllww', 'wwwwwwbwwwwww', 'wlllllbwllllw', 'wwwwwwbwwwwww', 'ccccccccccccc'], { w: PAPER, l: LINE, b: '#7A4A26', c: t })
    f(15, 17, 5, 3, '#ECE9E1', 'pg')
  },
  dev: (f, t) => {
    crabBody(f)
    f(8, 14, 14, 6, '#3A3A3C')
    f(9, 15, 12, 4, '#1E2530')
    f(10, 16, 5, 1, '#7EE787', 'cd'); f(16, 16, 3, 1, t, 'cd2')
    f(11, 17, 6, 1, '#79C0FF', 'cd2'); f(18, 17, 1, 1, '#fff', 'cur')
    f(6, 20, 18, 1, '#A4A8AF'); f(6, 21, 18, 1, '#6B6F76')
  },
  review: (f, t) => {
    crabBody(f, -4, 'it')
    f(7, 9, 16, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  plan: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 8, 16, ['bbbbbbbbbbbbb', 'bwbbbwbbbbwbb', 'bwwwwwbbbbwbb', 'bbbbbwwwwwwbb', 'bbbbbbbbbbbbb'], { b: '#3B6FB6', w: '#CFE0F7' })
    f(24, 3, 1, 1, '#F4B9A0', 'it'); f(24, 4, 1, 5, '#F5C542', 'it'); f(24, 9, 1, 1, INK, 'it')
  },
  test: (f, t) => {
    crabBody(f, -4)
    f(7, 9, 16, 1, t)
    stamp(f, 23, 4, ['.kk.', '.kk.', 'kggk', 'gggg', 'gggg', '.gg.'], { k: '#C9CCD2', g: '#5FD38D' })
    f(24, 2, 1, 1, '#5FD38D', 'bub'); f(25, 1, 1, 1, '#5FD38D', 'bub2')
  },
  write: (f, t) => {
    crabBody(f, -4, 'it')
    f(9, 15, 12, 7, PAPER)
    f(10, 16, 10, 1, t); f(10, 18, 9, 1, LINE); f(10, 20, 6, 1, LINE)
    f(26, 1, 1, 2, PAPER, 'it'); f(25, 2, 2, 4, PAPER, 'it'); f(24, 5, 2, 3, '#E6E8EE', 'it'); f(24, 8, 1, 2, INK, 'it')
  },
}

export const crab = (x: number, y: number, role: Role, isWalking: boolean, scale = 1.1): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  COSTUMES[role](f, ROLE_COLOR[role])
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="c-${role}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

export const AGENT_H = 50

/** The overview row: crab, task, role and model, progress bar. */
export const agentSvg = (W: number, a: AgentRun): string => {
  const role = roleOf(a)
  const color = ROLE_COLOR[role]
  const barW = W - 42 - 4
  const progress = progressOf(a)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctxOf(a) / 100))
  const right = progressText(a)
  const isRunning = a.status === 'running'
  return svg(
    W,
    AGENT_H,
    `${crab(0, 10, role, isRunning)}
${text(42, 17, fitText(a.description || a.type, 13, barW - 12), { size: 13, w: 600 })}
${isRunning ? `<circle class="live" cx="${W - 6}" cy="12" r="3.5" fill="${color}"/>` : ''}
<text x="42" y="33" font-size="11"><tspan fill="${color}">${xml(ROLE_WORD[role])}</tspan><tspan class="s">  ${xml(fitText(runModel(a), 11, barW - 140))}</tspan></text>
${text(42 + barW, 33, right, { size: 11, cls: 's', anchor: 'end', tabular: true })}
<rect class="k" x="42" y="40" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="40" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>`,
    CRAB_CSS,
  )
}

const TILE_H = 36

export const detailsHeight = (a: AgentRun): number => (a.stepNote ? 20 : 0) + TILE_H * 2 + 6 + 10

/** The expanded part: the worker's current step, then the stats as tiles. */
export const detailsSvg = (W: number, a: AgentRun, at: number): string => {
  const x0 = 42
  const gap = 6
  const tw = (W - x0 - gap * 2) / 3
  const top = a.stepNote ? 20 : 0
  const note = a.stepNote ? text(x0, 12, fitText(`${a.stepDone ?? 0}/${a.stepTotal ?? 0} · ${a.stepNote}`, 11, W - x0), { size: 11, cls: 's' }) : ''
  const tiles = statsOf(a, at)
    .map(([k, v], i) => {
      const x = x0 + (i % 3) * (tw + gap)
      const y = top + Math.floor(i / 3) * (TILE_H + gap)
      return (
        `<rect class="tile" x="${x}" y="${y}" width="${tw}" height="${TILE_H}" rx="7"/>` +
        text(x + 8, y + 14, k, { size: 10, cls: 's' }) +
        text(x + 8, y + 29, fitText(v, 12, tw - 14), { size: 12, w: 600, tabular: true })
      )
    })
    .join('')
  return svg(W, detailsHeight(a), `${note}${tiles}`)
}
