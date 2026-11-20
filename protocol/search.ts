// Search (⌘K): text folding and matching shared by the hub (filter, snippet) and the client (highlight), so both
// agree on what matches. Folding = lower case, accents removed (« Évènement » finds « evenement » and back).
// DOM-free and dependency-free: node tests it.

export const SEARCH_MAX_Q = 200;   // characters of the query
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_MIN_CHARS = 3; // folded characters, terms joined: below, the client does not ask (2 was a Scan for « de »)
export const SEARCH_MAX_HITS = 50;
export const SNIPPET_CHARS = 160;

/** Period filter of the palette: the client turns it into `since` (epoch ms) of the `search` frame. */
export type SearchPeriod = '7d' | '30d' | '1y' | 'all';
export const SEARCH_PERIODS: readonly SearchPeriod[] = ['7d', '30d', '1y', 'all'];
const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<Exclude<SearchPeriod, 'all'>, number> = { '7d': 7, '30d': 30, '1y': 365 };
/** Oldest date kept for a period (epoch ms), undefined for « all ». */
export const searchSince = (p: SearchPeriod, now: number): number | undefined => p === 'all' ? undefined : now - PERIOD_DAYS[p] * DAY_MS;

const foldCp = (c: string) => c.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Folded text and, for each folded UTF-16 unit, the index of the original unit it comes from. */
export function foldMap(s: string): { text: string; at: number[] } {
  let text = '', i = 0;
  const at: number[] = [];
  for (const c of s) { // code points: a surrogate pair stays whole
    const f = foldCp(c);
    text += f;
    for (let k = 0; k < f.length; k++) at.push(i);
    i += c.length;
  }
  return { text, at };
}
export const fold = (s: string) => foldMap(s).text;

/** Folded terms of a query (split on spaces, duplicates removed, at most SEARCH_MAX_TERMS). */
export function searchTerms(q: string): string[] {
  return [...new Set(fold(q).split(/\s+/).filter(Boolean))].slice(0, SEARCH_MAX_TERMS);
}
/** Enough to search: at least SEARCH_MIN_CHARS folded characters. */
export const searchable = (terms: string[]) => terms.join('').length >= SEARCH_MIN_CHARS;

/** Every term appears in the (already folded) text. */
export const matchesAll = (folded: string, terms: string[]) => terms.length > 0 && terms.every(x => folded.includes(x));

/** Ranges [start, end) of the original text where a term matches, sorted and merged (highlight). */
export function matchRanges(text: string, terms: string[]): [number, number][] {
  const { text: f, at } = foldMap(text);
  const r: [number, number][] = [];
  for (const x of terms) {
    for (let i = f.indexOf(x); i >= 0 && x; i = f.indexOf(x, i + x.length)) {
      const end = i + x.length < at.length ? at[i + x.length] : text.length;
      r.push([at[i], Math.max(end, at[i] + 1)]);
    }
  }
  r.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const x of r) { const last = out.at(-1); if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push([...x]); }
  return out;
}

/** One line around the first match: whitespace collapsed, at most `max` characters, « … » where cut. */
export function snippet(text: string, terms: string[], max = SNIPPET_CHARS): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const first = matchRanges(s, terms)[0]?.[0] ?? 0;
  let start = Math.max(0, Math.min(first - Math.floor(max / 3), s.length - max));
  if (start > 0) { const sp = s.indexOf(' ', start); if (sp >= 0 && sp < first) start = sp + 1; } // start on a word
  const end = Math.min(s.length, start + max);
  return (start > 0 ? '…' : '') + s.slice(start, end).trim() + (end < s.length ? '…' : '');
}
