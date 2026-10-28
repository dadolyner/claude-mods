// Pure SVG drawings for the desktop pane: each returns a string the renderer hands to Svg.
// No backgrounds of their own: the app's pane colour shows through.

import type { BarRow, ItemRow, Kv, Seg } from '../blocks'
import { C } from '../blocks'

export const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

export const CSS = `<style>
text{font-family:${FONT}}
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#2a2a29}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Rough advance of system UI text, in em; good enough to size a slot.
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Z@%mwMW]/.test(ch) ? 0.72 : 0.56)

export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

/** Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut. */
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

/** The largest size from `max` down to `min` at which `s` fits `maxW`. */
export const fitSize = (s: string, max: number, min: number, maxW: number): number => {
  const w = textWidth(s, 1)
  return w > 0 ? Math.max(min, Math.min(max, Math.floor((maxW / w) * 10) / 10)) : max
}

/** Cuts the start instead, for paths: `…/hooks/register.tsx`. */
export const fitStart = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of [...s].reverse()) {
    if (textWidth('…' + ch + out, size) > maxW) break
    out = ch + out
  }
  return '…' + out
}

export const svg = (W: number, H: number, body: string, extraCss = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${extraCss}${body}</svg>`

type T = { size?: number; w?: number; cls?: string; fill?: string; anchor?: 'start' | 'end' | 'middle'; tabular?: boolean }

export const text = (x: number, y: number, s: string, o: T = {}): string =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 12}" font-weight="${o.w ?? 400}"${o.fill ? ` fill="${o.fill}"` : ` class="${o.cls ?? 't'}"`}` +
  `${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.tabular ? ' font-variant-numeric="tabular-nums"' : ''}>${xml(s)}</text>`

const ROW = 22

/** Label on the left, value right-aligned. */
export const kvSvg = (W: number, rows: Kv[]): string => {
  const H = rows.length * ROW + 4
  const body = rows
    .map((r, i) => {
      const y = i * ROW + 15
      const vW = Math.max(60, W * 0.62)
      return (
        text(0, y, fitText(r.k, 12, W - vW - 8), { cls: 's' }) +
        text(W, y, fitText(r.v, 12, vW), { w: 600, anchor: 'end', fill: r.color, tabular: true }) +
        `<line class="ln" x1="0" y1="${i * ROW + ROW - 0.5}" x2="${W}" y2="${i * ROW + ROW - 0.5}"/>`
      )
    })
    .join('')
  return svg(W, H, body)
}

const TILE_H = 46

/** Label over a big value, in tiles three to a row (two when narrow). */
export const tilesSvg = (W: number, rows: Kv[]): string => {
  const cols = W < 300 ? 2 : 3
  // Labels at 10.5px: shrink rather than cut where they can.
  const gap = 6
  const tw = (W - gap * (cols - 1)) / cols
  const lines = Math.ceil(rows.length / cols)
  const H = lines * TILE_H + (lines - 1) * gap
  const body = rows
    .map((r, i) => {
      const x = (i % cols) * (tw + gap)
      const y = Math.floor(i / cols) * (TILE_H + gap)
      return (
        `<rect class="tile" x="${x}" y="${y}" width="${tw}" height="${TILE_H}" rx="8"/>` +
        text(x + 9, y + 17, fitText(r.k, fitSize(r.k, 10.5, 9, tw - 16), tw - 16), { size: fitSize(r.k, 10.5, 9, tw - 16), ...(r.accent ? { fill: r.accent, w: 600 } : { cls: 's' }) }) +
        valueText(x + 9, y + 36, r, tw - 16)
      )
    })
    .join('')
  return svg(W, H, body)
}

/** A tile's value: one colour, or coloured spans, shrunk to fit `maxW`. */
const valueText = (x: number, y: number, r: Kv, maxW: number): string => {
  if (!r.spans) return text(x, y, fitText(r.v, fitSize(r.v, 15, 10, maxW), maxW), { size: fitSize(r.v, 15, 10, maxW), w: 600, fill: r.color, tabular: true })
  const size = fitSize(r.spans.map(s => s.text).join(''), 15, 10, maxW)
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="600" font-variant-numeric="tabular-nums">${r.spans.map(s => `<tspan fill="${s.color}">${xml(s.text)}</tspan>`).join('')}</text>`
}

/** Label, a proportional bar, value. */
export const barsSvg = (W: number, rows: BarRow[]): string => {
  const labelW = Math.round(W * 0.38)
  const valueW = Math.round(W * 0.22)
  const barX = labelW + 8
  const barW = Math.max(30, W - labelW - valueW - 16)
  const H = rows.length * ROW + 4
  const body = rows
    .map((r, i) => {
      const y = i * ROW
      const fill = Math.max(r.ratio > 0 ? 2 : 0, Math.round(barW * Math.min(1, r.ratio)))
      return (
        text(0, y + 15, fitText(r.label, 12, labelW), { cls: 's' }) +
        `<rect class="k" x="${barX}" y="${y + 8}" width="${barW}" height="6" rx="3"/>` +
        `<rect x="${barX}" y="${y + 8}" width="${fill}" height="6" rx="3" fill="${r.color ?? C.accent}"/>` +
        text(W, y + 15, fitText(r.value, 12, valueW), { w: 600, anchor: 'end', tabular: true })
      )
    })
    .join('')
  return svg(W, H, body)
}

/** One stacked bar of the whole (`max`), then a legend row per segment. */
export const stackSvg = (W: number, total: number, max: number, segs: Seg[]): string => {
  let x = 0
  const bar = segs
    .map(s => {
      const w = max > 0 ? (W * s.tokens) / max : 0
      const r = `<rect x="${x}" y="0" width="${Math.max(0, w - 1)}" height="12" fill="${s.color}"/>`
      x += w
      return r
    })
    .join('')
  const free = `<rect class="k" x="0" y="0" width="${W}" height="12" rx="3"/>`
  const legend = segs
    .map((s, i) => {
      const y = 22 + i * 20
      return (
        `<rect x="0" y="${y + 3}" width="9" height="9" rx="2" fill="${s.color}"/>` +
        text(15, y + 11, fitText(s.name, 12, W * 0.6), { cls: 's' }) +
        text(W, y + 11, s.value, { w: 600, anchor: 'end', tabular: true })
      )
    })
    .join('')
  const H = 22 + segs.length * 20 + 4
  void total
  return svg(W, H, `<clipPath id="b"><rect width="${W}" height="12" rx="3"/></clipPath>${free}<g clip-path="url(#b)">${bar}</g>${legend}`)
}

const markSvg = (x: number, y: number, m: ItemRow['mark']): string => {
  if (m === 'done')
    return `<rect x="${x}" y="${y}" width="12" height="12" rx="3" fill="${C.green}"/><path d="M${x + 3} ${y + 6.2}l2.2 2.2 4-4.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  if (m === 'doing')
    return `<rect x="${x + 0.7}" y="${y + 0.7}" width="10.6" height="10.6" rx="3" fill="none" stroke="${C.accent}" stroke-width="1.4"/><rect class="live" x="${x + 3.5}" y="${y + 3.5}" width="5" height="5" rx="1.2" fill="${C.accent}"/>`
  return `<rect x="${x + 0.7}" y="${y + 0.7}" width="10.6" height="10.6" rx="3" fill="none" stroke="#9a9a96" stroke-width="1.4"/>`
}

/** A checklist: a mark and the item, the one in progress in bold. */
export const itemsSvg = (W: number, rows: ItemRow[]): string => {
  const H = rows.length * ROW + 4
  const body = rows
    .map((r, i) => {
      const y = i * ROW
      return (
        markSvg(0, y + 5, r.mark) +
        text(20, y + 15, fitText(r.text, 12.5, W - 22), { size: 12.5, w: r.mark === 'doing' ? 600 : 400, cls: r.mark === 'done' ? 'm' : 't' })
      )
    })
    .join('')
  return svg(W, H, body)
}

const chip = (x: number, y: number, label: string, color: string): { w: number; svg: string } => {
  const w = Math.round(textWidth(label, 11) + 14)
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="18" rx="6" fill="${color}" opacity=".16"/>` + text(x + w / 2, y + 12.5, label, { size: 11, w: 600, anchor: 'middle', fill: color }),
  }
}

export const HEADER_H = 48

/** The pane's top: the project on its own line, then branch and model chips and a live dot while work runs. */
export const headerSvg = (W: number, project: string, branch: string | null, model: string, isLive: boolean): string => {
  const name = fitText(project, 15, W - 16)
  let x = 0
  let chips = ''
  for (const [label, color] of [
    [branch, C.accent],
    [model, C.blue],
  ] as const) {
    if (!label || x > W - 60) continue
    const c = chip(x, 26, fitText(label, 11, W - x - 30), color)
    chips += c.svg
    x += c.w + 6
  }
  const live = isLive ? `<circle class="live" cx="${W - 6}" cy="11" r="4" fill="${C.green}"/>` : ''
  return svg(W, HEADER_H, text(0, 17, name, { size: 15, w: 700 }) + chips + live)
}

/** A changed file: status letter, path, and +/- counts. */
export const fileSvg = (W: number, path: string, status: string, added: number, removed: number, isTouched: boolean, tint?: string): string => {
  const color = tint ?? (status === 'A' || status === '?' ? C.green : status === 'D' ? C.red : status === 'R' ? C.blue : C.yellow)
  const counts = `+${added} −${removed}`
  const countsW = textWidth(counts, 11.5) + 6
  const dot = isTouched ? `<circle cx="${W - countsW - 10}" cy="11" r="3" fill="${C.accent}"/>` : ''
  return svg(
    W,
    22,
    `<rect x="0" y="4" width="15" height="15" rx="3.5" fill="${color}" opacity=".18"/>` +
      text(7.5, 15.5, status, { size: 10.5, w: 700, anchor: 'middle', fill: color }) +
      text(22, 15.5, fitStart(path, 12, W - 22 - countsW - 22), { size: 12 }) +
      dot +
      `<text x="${W}" y="15.5" font-size="11.5" font-weight="600" text-anchor="end" font-variant-numeric="tabular-nums"><tspan fill="${C.green}">+${added}</tspan><tspan fill="${C.red}"> −${removed}</tspan></text>`,
  )
}
