import type { BoxProps, TextProps } from 'claude-code'

// The band's whole look, matching the agents mod's cards: colours, sizes, the prop
// presets register.tsx spreads onto its elements, and the small drawings. Pure values only.

export type Mode = 'warm' | 'cold'

export const colors = {
  /** The USAGE tag: neutral, so it reads as the row's name, not a reading. */
  tag: '#8e8e93',
  /** A window's bar: calm blue, yellow from 80% used, red from 90%. */
  normal: '#3b7be8',
  warn: '#f5a623',
  danger: '#D0453F',
  /** The prompt cache's two states, desaturated to sit beside the windows' colours. */
  warm: '#cc6363',
  cold: '#6aaabd',
  /** The terminal's text form: cream text, muted labels, empty dots, ink on a chip. */
  text: '#e8e2d2',
  muted: '#8d8775',
  empty: '#4a463b',
  ink: '#1c1a16',
} as const

export const hue: Record<Mode, string> = { warm: colors.warm, cold: colors.cold }

export const font = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

export const sizes = {
  /** A window's bar at each band width: full, compact, tight. */
  barW: { full: 64, compact: 48, tight: 32 },
  barH: 6,
  /** The cache pill, with Robo inside, and its padding either side. */
  pillH: 18,
  robo: 12,
  pillPad: 7,
} as const

/** The bar's track, in light and dark: a step off the band's own colour so the empty part still shows. */
export const css = `<style>.track{fill:#d1d0cb}@media (prefers-color-scheme: dark){.track{fill:#48484a}}</style>`

// ---- element presets ----

/** The band: one row on the app's own band, its pieces split by thin dividers. */
export const band = {
  flexDirection: 'row',
  // Pieces never shrink, so on a pane too narrow even for the tight layout whole
  // pieces move to a second line instead of squeezing into each other.
  flexWrap: 'wrap',
  rowGap: 'xs',
  alignItems: 'center',
  columnGap: 'md',
  paddingX: 'sm',
} as const satisfies Partial<BoxProps>

/** One window or the cache: label, bar, figure, note. */
export const meter = { flexDirection: 'row', alignItems: 'center', gap: 'xs', flexShrink: 0 } as const satisfies Partial<BoxProps>

/** "5H", "7D". */
export const label = { dimColor: true, size: 'footnote', weight: 'semibold' } as const satisfies Partial<TextProps>

/** "15% used", "57m left": in the meter's colour. */
export const figure = { size: 'footnote', weight: 'semibold', tabular: true } as const satisfies Partial<TextProps>

/** The line between the 5-hour window, the 7-day window and the cache: a dim box-drawing bar, so it follows the theme. */
export const divider = { dimColor: true, size: 'footnote' } as const satisfies Partial<TextProps>

/** "· 20m". */
export const note = { dimColor: true, size: 'footnote', tabular: true } as const satisfies Partial<TextProps>

// ---- drawings ----

const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

/** A thin rounded bar, `ratio` of it filled in `color`. */
export const barSvg = (ratio: number, color: string, w: number): string => {
  const h = sizes.barH
  const fill = Math.round(w * Math.min(1, Math.max(0, ratio)))
  return svg(w, h, `${css}<rect class="track" width="${w}" height="${h}" rx="3"/><rect width="${fill}" height="${h}" rx="3" fill="${color}"/>`)
}

// Robo: bobbing when warm, frozen in ice when cold. SMIL only, so its Svg needs isInteractive.
const ROBO_PIX = ['..X..X..', 'XXXXXXXX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', 'XXXXXXXX', 'X..XX..X']

const mix = (a: string, b: string, t: number): string =>
  '#' +
  [1, 3, 5]
    .map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0'))
    .join('')

// One path, not a rect per pixel: separate rects at fractional sizes leave faint seams.
const pixels = (u: number, fill: string): string => {
  let d = ''
  ROBO_PIX.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') d += `M${x * u} ${y * u}h${u}v${u}h${-u}z`
    }),
  )
  return `<path d="${d}" fill="${fill}"/>`
}

const robo = (x: number, y: number, size: number, mode: Mode): string => {
  const ease = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"'
  if (mode === 'warm') {
    const u = size / 10
    return (
      `<g transform="translate(${x + u} ${y + 1.6 * u})" shape-rendering="crispEdges">` +
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-1.1 * u};0 0" dur="1.2s" repeatCount="indefinite" ${ease}/>` +
      pixels(u, colors.warm) +
      `<g opacity="0"><rect x="${u}" y="${3 * u}" width="${u}" height="${u}" fill="${colors.warm}"/><rect x="${6 * u}" y="${3 * u}" width="${u}" height="${u}" fill="${colors.warm}"/>` +
      `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.91;0.95;1" dur="3.4s" repeatCount="indefinite"/></g>` +
      `</g></g>`
    )
  }
  // Cold: still and pale, inside an ice block.
  const u = size / 12.2
  const ice = mix(colors.cold, '#ffffff', 0.5)
  const bx = -1.2 * u
  const by = -1.2 * u
  return (
    `<g transform="translate(${x + 1.6 * u} ${y + 1.6 * u})">` +
    pixels(u, ice) +
    `<rect x="${bx}" y="${by}" width="${10.4 * u}" height="${9.4 * u}" rx="${1.5 * u}" fill="${colors.cold}" fill-opacity=".28" stroke="${ice}" stroke-width="${0.38 * u}"/>` +
    `</g>`
  )
}

/** A tinted tag with a word in it, shaped like the cache pill: the row's USAGE name. */
export const tagSvg = (word: string, color: string): { source: string; w: number } => {
  const { pillH: h, pillPad: pad } = sizes
  // Bold caps at 10.5px with .6 tracking run about 7.8px a letter; centred, so an off estimate splits evenly.
  const wordW = Math.round(word.length * 7.8)
  const w = pad + wordW + pad
  return {
    w,
    source: svg(
      w,
      h,
      `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${color}" fill-opacity=".16"/>` +
        `<text x="${w / 2}" y="12.5" text-anchor="middle" font-family="${font}" font-size="10.5" font-weight="700" letter-spacing=".6" fill="${color}">${word}</text>`,
    ),
  }
}

/** The cache's state as a tinted pill: Robo, then WARM or COLD. Animated: needs isInteractive. */
export const pillSvg = (mode: Mode): { source: string; w: number } => {
  const word = mode === 'warm' ? 'WARM' : 'COLD'
  const color = hue[mode]
  const { pillH: h, robo: r, pillPad: pad } = sizes
  // Bold caps at 10.5px with .6 tracking run about 7.8px a letter.
  const wordW = Math.round(word.length * 7.8)
  const textX = pad + r + 5
  const w = textX + wordW + pad
  return {
    w,
    // The word is centred in its slot, so an estimate that is a little off splits evenly either side.
    source: svg(
      w,
      h,
      `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${color}" fill-opacity=".16"/>${robo(pad - 1, (h - r) / 2, r, mode)}` +
        `<text x="${textX + wordW / 2}" y="12.5" text-anchor="middle" font-family="${font}" font-size="10.5" font-weight="700" letter-spacing=".6" fill="${color}">${word}</text>`,
    ),
  }
}
