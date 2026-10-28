import type { EngineInterface, RenderChildren } from 'claude-code'

import type { Block, Mark } from './blocks'
import { C } from './blocks'
import { AGENT_H, ROLE_COLOR, ROLE_WORD, agentSvg, detailsHeight, detailsSvg, progressOf, progressText, roleOf, runModel, statsOf } from './draw/agents'
import { barsSvg, fileSvg, itemsSvg, kvSvg, stackSvg, tilesSvg } from './draw/svg'

export type Ui = ReturnType<EngineInterface['ui']['resolve']>

const MARK: Record<Mark, string> = { todo: '☐', doing: '◐', done: '☑' }
const ROLE_GLYPH = { research: '📖', dev: '💻', review: '🔍', plan: '📐', test: '🧪', write: '✍' } as const

const bar = (ratio: number, width: number): string => {
  const n = Math.max(0, Math.min(width, Math.round(width * ratio)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

/**
 * Draws a tab's blocks: SVG drawings at `W` px on a drawing surface, text rows
 * `cols` wide in the terminal.
 */
export const renderBlocks = (ui: Ui, hasSvg: boolean, W: number, cols: number, blocks: Block[], prefix = 'b'): RenderChildren[] => {
  const { Box, Text, Button, Code } = ui
  const Svg = hasSvg && 'Svg' in ui ? ui.Svg : null

  return blocks.map((b, i) => {
    const key = `${prefix}${i}`
    switch (b.t) {
      case 'section':
        return (
          <Box key={b.key} flexDirection="column" gap={1} marginTop={i === 0 ? 0 : 1}>
            <Button
              key={b.toggle.key}
              label={`${b.toggle.label}  ${b.title.toUpperCase()}${b.note ? `  ·  ${b.note}` : ''}`}
              plain
              dimColor
              onPress={() => void b.toggle.onPress()}
            />
            {b.isOpen ? renderBlocks(ui, hasSvg, W, cols, b.body, `${key}-`) : null}
          </Box>
        )
      case 'head':
        return (
          <Box key={key} flexDirection="row" gap={1} marginTop={i === 0 ? 0 : 1}>
            <Text bold dimColor>
              {b.text.toUpperCase()}
            </Text>
            {b.note ? <Text dimColor>{b.note}</Text> : null}
          </Box>
        )
      case 'note':
        return (
          <Text key={key} dimColor>
            {b.text}
          </Text>
        )
      case 'buttons':
        return (
          <Box key={key} flexDirection="row" gap={1} flexWrap="wrap">
            {b.buttons.map(p => (
              <Button key={p.key} label={p.label} dimColor onPress={() => void p.onPress()} />
            ))}
          </Box>
        )
      case 'code':
        return <Code key={key} source={b.source} format="diff" {...(b.path ? { path: b.path } : {})} />
    }

    if (Svg) {
      switch (b.t) {
        case 'kv':
          return <Svg key={key} source={kvSvg(W, b.rows)} alt={b.rows.map(r => `${r.k}: ${r.v}`).join(', ')} width={W} height={b.rows.length * 22 + 4} />
        case 'tiles': {
          const colsN = W < 300 ? 2 : 3
          const lines = Math.ceil(b.rows.length / colsN)
          return <Svg key={key} source={tilesSvg(W, b.rows)} alt={b.rows.map(r => `${r.k}: ${r.v}`).join(', ')} width={W} height={lines * 46 + (lines - 1) * 6} />
        }
        case 'bars':
          return <Svg key={key} source={barsSvg(W, b.rows)} alt={b.rows.map(r => `${r.label}: ${r.value}`).join(', ')} width={W} height={b.rows.length * 22 + 4} />
        case 'stack':
          return <Svg key={key} source={stackSvg(W, b.total, b.max, b.segs)} alt={b.segs.map(s => `${s.name}: ${s.value}`).join(', ')} width={W} height={22 + b.segs.length * 20 + 4} />
        case 'items':
          return <Svg key={key} source={itemsSvg(W, b.rows)} alt={b.rows.map(r => `${MARK[r.mark]} ${r.text}`).join(', ')} width={W} height={b.rows.length * 22 + 4} />
        case 'agent': {
          const rowW = W - 32
          return (
            <Box key={b.toggle.key} flexDirection="column">
              <Box flexDirection="row" alignItems="center" gap={1}>
                <Svg source={agentSvg(rowW, b.run)} alt={`${b.run.description}: ${runModel(b.run)}, ${progressText(b.run)}`} width={rowW} height={AGENT_H} />
                <Button key={b.toggle.key} label={b.toggle.label} plain dimColor onPress={() => void b.toggle.onPress()} />
              </Box>
              {b.isOpen ? (
                <Svg source={detailsSvg(rowW, b.run, b.at)} alt={statsOf(b.run, b.at).map(([k, v]) => `${k} ${v}`).join(', ')} width={rowW} height={detailsHeight(b.run)} />
              ) : null}
            </Box>
          )
        }
        case 'file': {
          const rowW = W - 32
          return (
            <Box key={b.toggle.key} flexDirection="row" alignItems="center" gap={1}>
              <Svg source={fileSvg(rowW, b.path, b.status, b.added, b.removed, b.isTouched, b.tint)} alt={`${b.status} ${b.path} +${b.added} -${b.removed}`} width={rowW} height={22} />
              <Button key={b.toggle.key} label={b.toggle.label} plain dimColor onPress={() => void b.toggle.onPress()} />
            </Box>
          )
        }
      }
    }

    // Terminal: the same blocks as text rows.
    const barW = Math.max(6, Math.min(24, cols - 30))
    switch (b.t) {
      case 'kv':
      case 'tiles':
        return (
          <Box key={key} flexDirection="column">
            {b.rows.map((r, j) => (
              <Box key={`${key}-${j}`} flexDirection="row" justifyContent="space-between">
                <Text dimColor wrap="truncate-end">
                  {r.k}
                </Text>
                {r.spans ? (
                  <Text bold wrap="truncate-end">
                    {r.spans.map((s, k) => (
                      <Text key={`${key}-${j}-${k}`} color={s.color}>
                        {s.text}
                      </Text>
                    ))}
                  </Text>
                ) : (
                  <Text bold {...(r.color ? { color: r.color } : {})} wrap="truncate-end">
                    {r.v}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )
      case 'bars':
        return (
          <Box key={key} flexDirection="column">
            {b.rows.map((r, j) => (
              <Text key={`${key}-${j}`} wrap="truncate-end">
                <Text color={r.color ?? C.accent}>{bar(r.ratio, barW)}</Text> <Text bold>{r.value}</Text> <Text dimColor>{r.label}</Text>
              </Text>
            ))}
          </Box>
        )
      case 'stack': {
        const width = Math.max(10, cols - 2)
        return (
          <Box key={key} flexDirection="column">
            <Text>
              {b.segs.map((s, j) => (
                <Text key={`${key}-s${j}`} color={s.color}>
                  {'█'.repeat(b.max > 0 ? Math.round((width * s.tokens) / b.max) : 0)}
                </Text>
              ))}
            </Text>
            {b.segs.map((s, j) => (
              <Text key={`${key}-l${j}`} wrap="truncate-end">
                <Text color={s.color}>■</Text> {s.name} <Text bold>{s.value}</Text>
              </Text>
            ))}
          </Box>
        )
      }
      case 'items':
        return (
          <Box key={key} flexDirection="column">
            {b.rows.map((r, j) => (
              <Text key={`${key}-${j}`} wrap="truncate-end" bold={r.mark === 'doing'} dimColor={r.mark === 'done'}>
                {MARK[r.mark]} {r.text}
              </Text>
            ))}
          </Box>
        )
      case 'agent': {
        const role = roleOf(b.run)
        const progress = progressOf(b.run)
        return (
          <Box key={b.toggle.key} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" gap={1}>
              <Text>{ROLE_GLYPH[role]}</Text>
              <Text bold wrap="truncate-end">
                {b.run.description || b.run.type}
              </Text>
              <Button key={b.toggle.key} label={b.toggle.label} plain dimColor onPress={() => void b.toggle.onPress()} />
            </Box>
            <Text wrap="truncate-end">
              {'   '}
              <Text color={ROLE_COLOR[role]}>{ROLE_WORD[role]}</Text>
              <Text dimColor> · {runModel(b.run)}</Text>
            </Text>
            <Text wrap="truncate-end">
              {'   '}
              <Text {...(progress === null ? { dimColor: true } : { color: ROLE_COLOR[role] })}>
                {bar(progress ?? 0, barW)}
              </Text>
              <Text dimColor> {progressText(b.run)}</Text>
            </Text>
            {b.isOpen ? (
              <Text dimColor wrap="truncate-end">
                {'   '}
                {statsOf(b.run, b.at)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}{' '}
              </Text>
            ) : null}
          </Box>
        )
      }
      case 'file':
        return (
          <Box key={b.toggle.key} flexDirection="row" gap={1}>
            <Text bold color={b.tint ?? (b.status === 'D' ? C.red : b.status === 'A' || b.status === '?' ? C.green : C.yellow)}>
              {b.status}
            </Text>
            <Text wrap="truncate-end">{b.path}</Text>
            <Text color={C.green}>+{b.added}</Text>
            <Text color={C.red}>−{b.removed}</Text>
            {b.isTouched ? <Text color={C.accent}>●</Text> : null}
            <Button key={b.toggle.key} label={b.toggle.label} plain dimColor onPress={() => void b.toggle.onPress()} />
          </Box>
        )
    }
    return null
  })
}
