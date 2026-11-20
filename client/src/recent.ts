/**
 * @ autocompletion by recency: the people you mentioned last come first, the rest alphabetically.
 * Recency is per space and per device (localStorage, no hub), updated when a message is SENT, not when a suggestion
 * is clicked. DOM-free so node can test it (client/test/recent.test.ts).
 */
import type { Person } from '../../protocol/frames.ts';

export const RECENT_MAX = 20;
export const recentKey = (space: string) => `briefling.recent.${space}`;

/** Same folding as the mention renderer in main.ts: accents and case ignored. */
const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const MENTION_RE = /@([\p{L}\p{N}_-]+)/gu;

/** Ids of the people of `people` mentioned in `text`, in text order, without duplicates. */
export function mentionedIds(text: string, people: Person[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const p = people.find(x => fold(x.name) === fold(m[1]));
    if (p && !out.includes(p.id)) out.push(p.id);
  }
  return out;
}

/** New recency list: `ids` first (in that order), then the previous ones, capped at RECENT_MAX. */
export function bump(recent: string[], ids: string[]): string[] {
  return [...ids, ...recent.filter(x => !ids.includes(x))].slice(0, RECENT_MAX);
}

/** Reads a stored list; anything malformed (hand-edited, older format) counts as empty. */
export function parseRecent(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

/** Suggestions for the query after `@`: name prefix (case-insensitive), recent first, then alphabetical. */
export function rankPeople(people: Person[], query: string, recent: string[], me: string | null): Person[] {
  const q = query.toLowerCase();
  const rank = (p: Person) => { const i = recent.indexOf(p.id); return i < 0 ? Infinity : i; };
  return people
    .filter(p => p.id !== me && !p.gone && p.name.toLowerCase().startsWith(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
