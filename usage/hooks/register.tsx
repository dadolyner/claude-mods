import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Window } from '../types'
import type { Mode } from './styles'
import { band, barSvg, colors, divider as dividerStyle, figure, hue, label, meter, note, pillSvg, sizes, tagSvg } from './styles'

// A one-row band above the prompt: how much of each usage window is LEFT (5-hour
// first, then 7-day) and when each resets, and once the first reply is in, the
// prompt cache: WARM for an hour after the last request, then COLD. Zero token
// cost: it reads the engine's own figures and draws.

const CELLS = 10
const TIGHT_CELLS = 6
/** A window under this percent left shows LOW, in red. */
const LOW_AT = 15
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000
/** The prompt cache lives an hour after the last request that read or wrote it. */
const TTL_MIN = 60
const TTL_MS = TTL_MIN * 60 * 1000
/** The terminal's row needs about 78 columns for two windows; under that, each window stacks. */
const WIDE_AT = 78
/** Under this the terminal's dot bars shrink and the cache gets its own row. */
const TIGHT_AT = 42
/** The drawn band: full from here ("left", reset times), compact above BAND_TIGHT_AT (no "left"), tight below (no reset times either). The USAGE tag shows at every width. */
const BAND_FULL_AT = 120
const BAND_TIGHT_AT = 85

const windows = atom({ plugin: 'usage', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'usage', key: 'cache' } as const, null as CacheFacts | null)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }
const WINDOW_COLOR: Record<string, string> = { seven_day: colors.sevenDay, five_hour: colors.fiveHour }
const WORD: Record<Mode, string> = { warm: 'WARM', cold: 'COLD' }

/** 18m, 2h 5m, 3d 9h. */
const fmtSpan = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  return ms <= 0 ? 'resetting' : fmtSpan(ms)
}

type CacheView = { mode: Mode; idle: string; minutesLeft: number }

/** What the band shows of the cache, or null until a request and its context size are known. */
const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  return {
    mode: idleMs >= TTL_MS ? 'cold' : 'warm',
    idle: fmtSpan(idleMs),
    minutesLeft: Math.max(0, TTL_MIN - Math.floor(idleMs / 60000)),
  }
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      const isLow = left < LOW_AT
      return {
        left,
        isLow,
        color: isLow ? colors.low : (WINDOW_COLOR[w.kind] ?? colors.text),
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        reset: fmtReset(w.resetsAt, now),
      }
    }
    const cacheFigure = (v: CacheView) => (v.mode === 'cold' ? `${v.idle} idle` : `${v.minutesLeft}m left`)

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100

    // Drawing surfaces: one row, a thin divider between each window and the cache,
    // dropping detail as the band narrows so nothing squeezes into the next piece.
    if (Svg) {
      const fit = columns >= BAND_FULL_AT ? 'full' : columns >= BAND_TIGHT_AT ? 'compact' : 'tight'
      const pill = view ? pillSvg(view.mode) : null
      const tag = tagSvg('USAGE', colors.tag)
      const divider = (key: string) => (
        <Text key={key} {...dividerStyle}>
          │
        </Text>
      )
      return (
        <Box {...band}>
          <Svg source={tag.source} alt="Usage" width={tag.w} height={sizes.pillH} />
          {divider('d-tag')}
          {list.length === 0 ? <Text {...note}>waiting for the first reply</Text> : null}
          {list.flatMap((w, i) => {
            const p = parts(w)
            return [
              ...(i > 0 ? [divider(`d-${w.kind}`)] : []),
              <Box key={w.kind} {...meter}>
                <Text {...label}>{p.name}</Text>
                <Svg source={barSvg(p.left / 100, p.color, sizes.barW[fit])} alt={`${p.name} ${p.left}% left`} width={sizes.barW[fit]} height={sizes.barH} />
                <Text {...figure} color={p.color}>
                  {p.left}%{fit === 'full' ? ' left' : ''}{p.isLow ? ' · LOW' : ''}
                </Text>
                {p.reset && fit !== 'tight' ? <Text {...note}>· {p.reset}</Text> : null}
              </Box>,
            ]
          })}
          {view && pill && list.length > 0 ? divider('d-cache') : null}
          {view && pill ? (
            <Box key="cache" {...meter}>
              <Svg source={pill.source} alt={`Cache ${WORD[view.mode].toLowerCase()}`} width={pill.w} height={sizes.pillH} isInteractive />
              <Text {...figure} color={hue[view.mode]}>
                {fit === 'full' ? cacheFigure(view) : cacheFigure(view).replace(' left', '').replace(' idle', '')}
              </Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    // The terminal: dot bars in text. Wide: every window on one row. Narrow: each
    // window is a block of three lines so nothing wraps or clips.
    const kind = columns >= WIDE_AT ? 'wide' : columns >= TIGHT_AT ? 'stacked' : 'tight'
    const cells = kind === 'tight' ? TIGHT_CELLS : CELLS
    const dots = (left: number): { on: string; off: string } => {
      const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
      return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
    }

    const wide = (w: Window) => {
      const p = parts(w)
      const d = dots(p.left)
      return (
        <Box key={w.kind} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text color={colors.muted} bold>{p.name} </Text>
          <Text color={p.color}>{d.on}</Text>
          <Text color={colors.empty}>{d.off}</Text>
          <Text color={p.color} bold> {p.left}% left{p.isLow ? ' LOW' : ''}</Text>
          {p.reset ? <Text color={colors.muted}> · {p.reset}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window) => {
      const p = parts(w)
      const d = dots(p.left)
      return (
        <Box key={w.kind} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text color={colors.muted} bold>{p.name} </Text>
            <Text color={p.color}>{d.on}</Text>
            <Text color={colors.empty}>{d.off}</Text>
          </Box>
          <Text color={p.color} bold>{p.left}% left{p.isLow ? ' LOW' : ''}</Text>
          {p.reset ? <Text color={colors.muted}>resets {p.reset}</Text> : null}
        </Box>
      )
    }

    const usageLabel = (
      <Box key="label" flexShrink={0} marginRight={3}>
        <Text color={colors.text} bold>USAGE</Text>
      </Box>
    )
    const usage =
      list.length > 0
        ? list.map(kind === 'wide' ? wide : stacked)
        : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={colors.muted}>waiting for the first reply</Text></Box>]

    if (!view) {
      return (
        <Box flexDirection="row" paddingX={1}>
          {usageLabel}
          {usage}
        </Box>
      )
    }

    const color = hue[view.mode]
    const cacheText = (
      <Box key="cache" flexDirection="row" flexShrink={0} alignItems="center">
        <Text backgroundColor={color} color={colors.ink} bold>{` ${WORD[view.mode]} `}</Text>
        <Text color={color} bold> {cacheFigure(view)}</Text>
      </Box>
    )

    // Narrow: the cache gets its own row under the usage blocks.
    return kind === 'tight' ? (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          {usageLabel}
          {usage}
        </Box>
        <Box flexDirection="row" paddingX={1}>
          {cacheText}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="row" paddingX={1} alignItems={kind === 'wide' ? 'center' : undefined}>
        {usageLabel}
        {usage}
        {cacheText}
      </Box>
    )
  })
}
