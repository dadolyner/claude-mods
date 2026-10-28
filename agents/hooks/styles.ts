import type { BoxProps, TextProps } from 'claude-code'

// The mod's whole look: colours, the SVG style blocks, sizes, and the prop presets
// register.tsx spreads onto its elements (`<Box {...card}>`). Pure values only.

export type Role = 'research' | 'dev' | 'review' | 'plan' | 'test' | 'write'

export const colors = {
	/** The band's flow in progress, and once it is done. */
	accent: '#8f8cf4',
	done: '#5fbf8f',
	failed: '#D0453F',
	/** The crab's body, eyes and props. */
	clay: '#D97757',
	ink: '#1F1E1D',
	paper: '#F8F6F1',
	line: '#B9B6AE',
	/** Text on a filled pill. */
	white: '#ffffff',
	/** The crab costumes' props: glasses and book, laptop, magnifier, hard hat and blueprint, flask, quill. */
	prop: {
		frame: '#3A3A3C',
		wood: '#7A4A26',
		page: '#ECE9E1',
		screen: '#1E2530',
		codeGreen: '#7EE787',
		codeBlue: '#79C0FF',
		white: '#fff',
		keys: '#A4A8AF',
		base: '#6B6F76',
		glass: 'rgba(169,214,245,.7)',
		hat: '#F5C542',
		hatLight: '#FBE08A',
		hatDark: '#C99A1E',
		blueprint: '#3B6FB6',
		blueprintLine: '#CFE0F7',
		eraser: '#F4B9A0',
		flask: '#C9CCD2',
		liquid: '#5FD38D',
		quill: '#E6E8EE',
	},
	/** The agent card's own surface and edge; the desktop pane is dark like the ribbon band. */
	cardBg: '#1d1d1f',
	cardEdge: '#2e2e30',
	role: {
		research: '#378ADD',
		dev: '#1D9E75',
		review: '#D85A30',
		plan: '#BA7517',
		test: '#7F77DD',
		write: '#C2588F',
	} satisfies Record<Role, string>,
} as const

export const font = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

export const sizes = {
	/** The band row and its bar. */
	bandH: 22,
	bandBarH: 16,
	/** The band's crab slot, and the crab's drawing grid (30 units wide, props included). */
	crabW: 26,
	crabBox: 30,
	bandCrabScale: 0.8,
	/** The band bar's dither cell. */
	cell: 3,
	/** The agent card: icon tile, status pill, progress line. */
	icon: 40,
	pillH: 18,
	lineH: 6,
} as const

export const css = {
	/** The band's text and bar; its pixels twinkle in four out-of-phase groups, a finished bar settles to a slow glow. */
	band: (isFinished: boolean): string => `<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
.t0,.t1,.t2,.t3{animation:tw ${isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>`,
	// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
	// once-a-second redraw of a running row restarts them in phase. Every crab walks;
	// each costume adds its prop's own motion on top.
	crab: `<style>
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
</style>`,
	/** The agent card's drawings: icon tile and bar track, in light and dark. */
	card: `<style>
.tile{fill:#ecebe8}.track{fill:#e4e3df}.dim{fill:#8a8a86}
@media (prefers-color-scheme: dark){.tile{fill:#2a2a2c}.track{fill:#2c2c2e}.dim{fill:#8e8e93}}
</style>`,
} as const

// ---- element presets ----

/** The panel's column of agent cards. */
export const list = { flexDirection: 'column', gap: 1 } as const satisfies Partial<BoxProps>

/** One agent's card. */
export const card = {
	flexDirection: 'column',
	gap: 1,
	backgroundColor: colors.cardBg,
	borderStyle: 'round',
	borderColor: colors.cardEdge,
	// A step, not cells: the desktop sizes it the same across and down.
	padding: 'sm',
} as const satisfies Partial<BoxProps>

/** Icon, title column and percent. */
export const headRow = { flexDirection: 'row', alignItems: 'center', gap: 2 } as const satisfies Partial<BoxProps>

/** The title and subtitle, taking the space the icon and percent leave. */
export const titleColumn = { flexDirection: 'column', flexGrow: 1, flexShrink: 1 } as const satisfies Partial<BoxProps>

/** The task name and its status pill. */
export const titleRow = { flexDirection: 'row', alignItems: 'center', gap: 1 } as const satisfies Partial<BoxProps>

/** Under the bar: the step and current action left, time · tokens · cost right. */
export const stepRow = { flexDirection: 'row', justifyContent: 'space-between', gap: 2 } as const satisfies Partial<BoxProps>

/** The band's drawing and its buttons. */
export const bandRow = { flexDirection: 'row', alignItems: 'center', gap: 1 } as const satisfies Partial<BoxProps>

export const subtitle = { dimColor: true, size: 'footnote', wrap: 'truncate-end' } as const satisfies Partial<TextProps>

export const percent = { size: 'heading', weight: 'semibold', tabular: true } as const satisfies Partial<TextProps>

/** The task name. */
export const titleText = { weight: 'semibold', wrap: 'truncate-end' } as const satisfies Partial<TextProps>

/** "Step 2 of 4 · listed the newest migrations". */
export const stepText = { dimColor: true, size: 'footnote', wrap: 'truncate-end' } as const satisfies Partial<TextProps>

/** "8s · 223k tokens · $0.01". */
export const usageText = { dimColor: true, size: 'footnote', tabular: true } as const satisfies Partial<TextProps>

// ---- text in drawings ----

export const xml = (s: string): string =>
	s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// CJK, fullwidth forms and emoji advance about 1em; sized at the average they were
// underestimated by half and the band's bar drew over a title.
const WIDE =
	/[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏！-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

/** Rough advance of system UI text, in em; good enough to size a slot. */
const charEm = (ch: string): number => (WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56)

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

/** An SVG document; `style` is one of the `css` blocks the drawing's classes need. */
export const svg = (W: number, H: number, body: string, style = ''): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style}${body}</svg>`
