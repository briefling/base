// Resizable desktop columns: a vertical grip on each column edge above 700 px (sidebar, list, the right
// column shared by Recents and the thread info, the feed / pane split of the Lounge); double-click = default width.
// Widths live in `localStorage['briefling.cols']` as an object keyed by column name, never as a positional array or a
// grid-template string: a column added or removed one day takes its default and an old key is ignored, so no stored
// value can shift the others. Applied as CSS variables on <html> (`--w-side`, `--w-list`, `--w-info`, `--split`), read
// by `.shell` in style.css whose fallbacks are the defaults; CSSOM writes pass the CSP (no inline style attribute).
// The pure part (parse, fit, drag maths) is tested in client/test/panes.test.ts.
import { t } from './i18n.ts';

export type Col = 'side' | 'list' | 'info' | 'split';
export type Cols = Partial<Record<Col, number>>;
export const COLS_KEY = 'briefling.cols';
/** px for side/list/info; `split` is the share of the Lounge's side pane in feed + pane (0..1). */
export const BOUNDS: Record<Col, readonly [number, number]> = { side: [160, 400], list: [240, 640], info: [240, 720], split: [0.25, 0.75] };
/** Same values as the fallbacks in style.css (info: Recents' 360, the wider of Recents 360 / info 300, to stay safe). */
export const DEFAULTS: Record<Col, number> = { side: 210, list: 360, info: 360, split: 0.5 };
/** What the centre keeps at least: the conversation, or the feed + pane of a Lounge split. */
export const CENTER_MIN = 360, SPLIT_CENTER_MIN = 640;
const PX: Col[] = ['side', 'list', 'info'];
/** Shrunk first when the window is too narrow for the stored widths. */
const SHRINK: Col[] = ['list', 'info', 'side'];

const clamp = (c: Col, v: number) => Math.min(BOUNDS[c][1], Math.max(BOUNDS[c][0], v));

/** Stored widths: invalid JSON, a non-object, unknown keys and non-finite values are dropped; each width is bounded. */
export function parseCols(raw: string | null): Cols {
  let o: unknown;
  try { o = JSON.parse(raw ?? ''); } catch { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out: Cols = {};
  for (const c of Object.keys(BOUNDS) as Col[]) {
    const v = (o as Record<string, unknown>)[c];
    if (typeof v === 'number' && Number.isFinite(v)) out[c] = clamp(c, v);
  }
  return out;
}

/**
 * Widths to show for a window `vw` px wide where the px columns `present` are on screen: each bounded, then the set
 * ones shrunk (list, info, side) down to their minimum until the centre keeps `center` px. Columns left at their
 * default are never touched (today's layout). The stored value stays as is: a wider window gives it back.
 */
export function fitCols(cols: Cols, present: Col[], vw: number, center = CENTER_MIN): Cols {
  const out: Cols = {};
  for (const c of Object.keys(cols) as Col[]) out[c] = clamp(c, cols[c]!);
  const on = PX.filter(c => present.includes(c));
  let excess = on.reduce((s, c) => s + (out[c] ?? DEFAULTS[c]), 0) - (vw - center);
  for (const c of SHRINK) {
    if (excess <= 0) break;
    if (!on.includes(c) || out[c] === undefined) continue;
    const cut = Math.min(excess, out[c]! - BOUNDS[c][0]);
    out[c] = out[c]! - cut; excess -= cut;
  }
  return out;
}

/**
 * Width after dragging the grip `dx` px from `start`: side and list grow to the right, the right column to the left;
 * `split` (start = pane share, `total` = feed + pane px) gives its share. Bounded.
 */
export function dragged(c: Col, start: number, dx: number, total = 0): number {
  if (c === 'split') return clamp(c, total > 0 ? start - dx / total : start);
  return clamp(c, c === 'info' ? start - dx : start + dx);
}

/** CSS variables for `cols` (null = removed, the stylesheet default applies). The split becomes the pane's fr weight. */
export function colVars(cols: Cols): Record<string, string | null> {
  const px = (c: Col) => cols[c] === undefined ? null : `${Math.round(cols[c]!)}px`;
  const s = cols.split;
  return { '--w-side': px('side'), '--w-list': px('list'), '--w-info': px('info'), '--split': s === undefined ? null : `${+(s / (1 - s)).toFixed(4)}fr` };
}

export type PaneLayout = { lounge: '' | 'lounge-full' | 'lounge-split'; list: boolean; info: boolean; recents: boolean };

/** Grips of a layout: the sidebar always; the list, or the Lounge split; the right column (info or Recents). */
export function gripsOf(l: PaneLayout): Col[] {
  return ['side', ...(l.lounge === 'lounge-split' ? ['split' as const] : l.list && !l.lounge ? ['list' as const] : []),
    ...(l.info || l.recents ? ['info' as const] : [])];
}

// ---- DOM: stored widths, applied on every render and window resize, grips dragged without a render ----

let stored: Cols | null = null, layout: PaneLayout = { lounge: '', list: true, info: false, recents: false }, listening = false;
const load = () => stored ??= parseCols(safe(() => localStorage.getItem(COLS_KEY)) ?? null);
const save = () => safe(() => localStorage.setItem(COLS_KEY, JSON.stringify(stored)));
function safe<T>(f: () => T): T | undefined { try { return f(); } catch { return undefined; } }

function present(l: PaneLayout): Col[] {
  return ['side', ...(l.list && !l.lounge ? ['list' as const] : []), ...(l.recents || (l.info && innerWidth > 1100) ? ['info' as const] : [])];
}

function show(cols: Cols) {
  const fit = fitCols(cols, present(layout), innerWidth, layout.lounge === 'lounge-split' ? SPLIT_CENTER_MIN : CENTER_MIN);
  const st = document.documentElement.style;
  for (const [k, v] of Object.entries(colVars(fit))) {
    if (v === null) { if (st.getPropertyValue(k)) st.removeProperty(k); }
    else if (st.getPropertyValue(k) !== v) st.setProperty(k, v);
  }
  return fit;
}

/** Called after each render with the shell's layout. */
export function applyCols(l: PaneLayout) {
  layout = l;
  if (!listening) { listening = true; addEventListener('resize', () => show(load())); }
  show(load());
}

function start(c: Col, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  const grip = e.currentTarget as HTMLElement, shell = grip.parentElement!;
  const w = getComputedStyle(shell).gridTemplateColumns.split(' ').map(parseFloat);
  const aside = shell.querySelector('aside.recents');
  const total = c === 'split' ? w[1] + w[2] : 0;
  const from = c === 'side' ? w[0] : c === 'list' ? w[1] : c === 'split' ? w[2] / total : aside ? aside.getBoundingClientRect().width : w[w.length - 1];
  const x0 = e.clientX;
  let now: number | undefined;
  grip.setPointerCapture(e.pointerId);
  document.documentElement.classList.add('resizing');
  const move = (m: PointerEvent) => { now = show({ ...load(), [c]: dragged(c, from, m.clientX - x0, total) })[c]; };
  const end = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
    document.documentElement.classList.remove('resizing');
    if (now !== undefined) { stored = { ...load(), [c]: now }; save(); }
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
}

function reset(c: Col) {
  const next = { ...load() };
  delete next[c];
  stored = next; save(); show(next);
}

/** The grips of the shell (absolutely placed on their grid column by style.css); `h` is main.ts' element builder. */
export function grips(l: PaneLayout, h: (tag: string, attrs: Record<string, unknown>) => HTMLElement) {
  return gripsOf(l).map(c => h('div', {
    class: `grip g-${c}`, 'data-k': `g:${c}`, role: 'separator', 'aria-orientation': 'vertical', title: t('col_resize'),
    onpointerdown: (e: PointerEvent) => start(c, e), ondblclick: () => reset(c),
  }));
}
