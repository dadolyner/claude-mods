import type { AgentRun } from '../types'

// What a tab draws, as data: each tab returns a list of blocks and `render.tsx`
// draws them for the surface (SVG on desktop, text in the terminal).

export type Span = { text: string; color: string }
/** A label and its value; `spans` draws the value in several colours, `accent` colours the label. */
export type Kv = { k: string; v: string; color?: string; spans?: Span[]; accent?: string }
export type BarRow = { label: string; value: string; ratio: number; color?: string }
export type Seg = { name: string; value: string; tokens: number; color: string }
export type Mark = 'todo' | 'doing' | 'done'
export type ItemRow = { mark: Mark; text: string }
export type Press = { key: string; label: string; onPress: () => unknown }

export type Block =
  | { t: 'head'; text: string; note?: string }
  /** A heading whose ▾/▸ folds the blocks under it. */
  | { t: 'section'; key: string; title: string; note?: string; isOpen: boolean; toggle: Press; body: Block[] }
  | { t: 'kv'; rows: Kv[] }
  | { t: 'tiles'; rows: Kv[] }
  | { t: 'bars'; rows: BarRow[] }
  | { t: 'stack'; total: number; max: number; segs: Seg[] }
  | { t: 'items'; rows: ItemRow[] }
  | { t: 'agent'; run: AgentRun; at: number; isOpen: boolean; toggle: Press }
  | { t: 'file'; path: string; status: string; added: number; removed: number; isTouched: boolean; isOpen: boolean; toggle: Press; tint?: string }
  | { t: 'code'; source: string; path?: string }
  | { t: 'buttons'; buttons: Press[] }
  | { t: 'note'; text: string }

// The hub's palette: muted so it sits on the app's own pane colour in both themes.
export const C = {
  accent: '#8f8cf4',
  green: '#3B9C5F',
  red: '#D0453F',
  orange: '#ff6b1a',
  yellow: '#f5a623',
  blue: '#378ADD',
  warm: '#cc6363',
  cold: '#6aaabd',
  grey: '#888780',
} as const
