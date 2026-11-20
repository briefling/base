// Memory view (project memory of a space): DOM-free logic, tested in client/test/memory.test.ts.
// The hub checks every decision again (membership, reviewer, trust, version): here, only what to show.
import { fold, searchTerms, matchesAll } from '../../protocol/search.ts';
import { MEMORY_REVIEW_RUNNING_MS, MEMORY_TAGS_MAX, tagOf, type MemoryRun, type MemoryAction, type MemoryEntry, type MemoryMode, type MemoryStatus, type MemoryVocab, type MemoryWake } from '../../protocol/memory.ts';

export type MemoryTab = MemoryStatus;
export const MEMORY_TABS: MemoryTab[] = ['pending', 'published', 'archived', 'rejected'];
/** What the hub sent for a space (`memory` frame), kept up to date by `memory.updated`. */
export interface MemoryState { mode: MemoryMode; entries: MemoryEntry[]; review: boolean; trusted: boolean; agent: string; vocab?: MemoryVocab }

export function counts(entries: MemoryEntry[]): Record<MemoryTab, number> {
  const c: Record<MemoryTab, number> = { pending: 0, published: 0, archived: 0, rejected: 0 };
  for (const e of entries) c[e.status]++;
  return c;
}
/** Opening the view: what waits for a review first, else what agents read. */
export const defaultTab = (entries: MemoryEntry[]): MemoryTab => entries.some(e => e.status === 'pending') ? 'pending' : 'published';

/**
 * Entries of a tab, most recent first, with the picked tag (none: all) and every typed word (text, sources and tags,
 * accents folded).
 */
export function shown(entries: MemoryEntry[], tab: MemoryTab, q: string, tag = ''): MemoryEntry[] {
  const terms = searchTerms(q);
  return entries.filter(e => e.status === tab && (!tag || !!e.tags?.includes(tag))
    && (!terms.length || matchesAll(fold(`${e.text}\n${e.sources.join('\n')}\n${(e.tags ?? []).join(' ')}`), terms)))
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}
/**
 * Tag filter bar of a tab: its entries' tags with their count there (what clicking shows), most used first, then by
 * name. The picked tag stays listed (count 0) when this tab has none, so it can be cleared.
 */
export function tabTags(entries: MemoryEntry[], tab: MemoryTab, picked = ''): { tag: string; n: number }[] {
  const n = new Map<string, number>();
  for (const e of entries) if (e.status === tab) for (const t of e.tags ?? []) n.set(t, (n.get(t) ?? 0) + 1);
  if (picked && !n.has(picked)) n.set(picked, 0);
  return [...n].map(([tag, k]) => ({ tag, n: k })).sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : 1));
}
/** Tags used by fewer entries than this are folded under « N rare tags » in the tag column. */
export const MEM_TAG_RARE = 3;
/**
 * Left column of the view (a list of tags on the phone): « All » with the tab's count, the tags used at least
 * `MEM_TAG_RARE` times in the tab, then the rare ones (folded). The picked tag is always listed, even rare or unused.
 */
export function tagColumn(entries: MemoryEntry[], tab: MemoryTab, picked = ''): { all: number; main: { tag: string; n: number }[]; rare: { tag: string; n: number }[] } {
  const tags = tabTags(entries, tab, picked);
  const listed = (x: { tag: string; n: number }) => x.n >= MEM_TAG_RARE || x.tag === picked;
  return { all: entries.filter(e => e.status === tab).length, main: tags.filter(listed), rare: tags.filter(x => !listed(x)) };
}
/** The tag that marks a decision: inside another picked tag, decisions come first. */
export const DECISION_TAG = 'decision';
/**
 * The list of a picked tag in sections: its decisions first, then the rest, each keeping its order. One unnamed
 * section when nothing to split: no tag picked (All), the picked tag is `decision` itself, or no decision in it.
 */
export function sections(list: MemoryEntry[], tag: string): { key: 'decisions' | 'rest' | null; entries: MemoryEntry[] }[] {
  const isDec = (e: MemoryEntry) => !!e.tags?.includes(DECISION_TAG);
  if (!tag || tag === DECISION_TAG || !list.some(isDec)) return [{ key: null, entries: list }];
  const rest = list.filter(e => !isDec(e));
  return [{ key: 'decisions', entries: list.filter(isDec) }, ...(rest.length ? [{ key: 'rest' as const, entries: rest }] : [])];
}
/** Tags typed by a trusted human (comma or space separated), each normalized as the hub stores it, duplicates dropped. */
export function parseTags(s: string): { tags: string[] } | { error: 'bad'; bad: string } | { error: 'too_many' } {
  const tags: string[] = [];
  for (const raw of s.split(/[\s,]+/).filter(Boolean)) {
    const t = tagOf(raw);
    if (!t) return { error: 'bad', bad: raw };
    if (!tags.includes(t)) tags.push(t);
  }
  return tags.length > MEMORY_TAGS_MAX ? { error: 'too_many' } : { tags };
}
/** Published entries without any tag: « Tag entries » is useless without them. */
export const untaggedCount = (entries: MemoryEntry[]) => entries.filter(e => e.status === 'published' && !e.tags?.length).length;

/** Buttons of an entry for this person (`review`: may approve/reject; `trusted`: may archive/restore). */
export function actionsOf(e: MemoryEntry, review: boolean, trusted: boolean): MemoryAction[] {
  if (e.status === 'pending' && (e.supersedes || e.replaces)) return trusted ? ['approve', 'reject'] : review ? ['reject'] : []; // approving archives: trusted
  if (e.status === 'pending') return review ? ['approve', 'reject'] : [];
  if (e.status === 'published') return trusted ? ['archive'] : [];
  if (e.status === 'archived') return trusted && !e.drop ? ['restore'] : []; // an approved drop: restore the removed entry itself
  if (e.status === 'rejected') return review ? ['approve'] : []; // a human overrides a rejection (the memory agent's included)
  return [];
}

/** Entries waiting for the memory agent (agent mode): « review now » is useless without them. */
export const queued = (entries: MemoryEntry[]) => entries.filter(e => e.status === 'pending' && e.gate === 'queued').length;

/**
 * « Compact »: why it cannot run now, null when it can (the hub checks again): no published entry, or a
 * synthesis already waits for a human (decide it first).
 */
export function compactBlock(entries: MemoryEntry[]): 'nothing' | 'pending' | null {
  if (entries.some(e => e.status === 'pending' && e.supersedes)) return 'pending';
  return entries.some(e => e.status === 'published') ? null : 'nothing';
}
/** The i18n key of the answer to « Review now » / « Compact » / « Tag entries »; '' = woken (the run banner says it). */
export function wokenKey(what: 'review' | 'compact' | 'tag', result: MemoryWake): string {
  if (result === 'woken') return '';
  if (result === 'unreached') return 'mem_woken_unreached';
  if (what === 'tag') return result === 'nothing' ? 'mem_tag_nothing' : 'mem_woken_running';
  if (what === 'review') return result === 'nothing' ? 'mem_woken_nothing' : 'mem_woken_running';
  return result === 'nothing' ? 'mem_compact_nothing' : result === 'pending' ? 'mem_compact_pending' : 'mem_woken_running';
}

/**
 * The Memory view's banner for the memory agent's turn: running (animated, until its end or MEMORY_REVIEW_RUNNING_MS
 * after the wake, then the hub considers it dead), or its result (closable): `key` = i18n key (plural base when `n`
 * counts), `pending` = a « To review » button.
 */
export type RunBanner = { busy: true; key: 'mem_run_review' | 'mem_run_compact' | 'mem_run_tag' }
  | { busy: false; key: 'mem_run_syntheses' | 'mem_run_waiting'; n: number; pending: true }
  | { busy: false; key: 'mem_run_compact_none' | 'mem_run_review_done' | 'mem_run_tag_done'; pending: false };
export function runBanner(run: MemoryRun | undefined, now: number): RunBanner | null {
  if (!run) return null;
  if (!run.ended) return now - run.since < MEMORY_REVIEW_RUNNING_MS ? { busy: true, key: `mem_run_${run.what}` } : null;
  const n = run.n ?? 0;
  if (run.what === 'tag') return { busy: false, key: 'mem_run_tag_done', pending: false };
  if (run.what === 'compact') return n ? { busy: false, key: 'mem_run_syntheses', n, pending: true } : { busy: false, key: 'mem_run_compact_none', pending: false };
  return n ? { busy: false, key: 'mem_run_waiting', n, pending: true } : { busy: false, key: 'mem_run_review_done', pending: false };
}
/** Keeps the newest run per space: a late start never hides an end, a new wake replaces an old result. */
export const newerRun = (cur: MemoryRun | undefined, next: MemoryRun): MemoryRun =>
  !cur || next.since > cur.since || (next.since === cur.since && !!next.ended) ? next : cur;
/** The entries a synthesis or a replacement replaces, as the page knows them (missing ones skipped). */
export const replacedBy = (entries: MemoryEntry[], e: MemoryEntry) =>
  (e.supersedes ?? e.replaces ?? []).map(id => entries.find(x => x.id === id)).filter((x): x is MemoryEntry => !!x);

/** « Import from repo » answer (`memory.imported`) as what the view says: done (counts), full (limit), or an error code. */
export type ImportNotice = { kind: 'done'; repo: string; sha: string; added: number; existing: number; failed: number }
  | { kind: 'full'; live: number; wanted: number } | { kind: 'error'; code: string };
export function importNotice(f: { repo: string; sha?: string; added: number; existing: number; failed: unknown[]; error?: string; live?: number; wanted?: number }): ImportNotice {
  if (f.error === 'memory_full') return { kind: 'full', live: f.live ?? 0, wanted: f.wanted ?? 0 };
  if (f.error) return { kind: 'error', code: f.error };
  return { kind: 'done', repo: f.repo, sha: (f.sha ?? '').slice(0, 7), added: f.added, existing: f.existing, failed: f.failed.length };
}

/**
 * « Tag merges » block of the view: the waiting merges with the number of entries each would retag (any status but
 * rejected, as the hub rewrites them), then the approved aliases, both sorted by name.
 */
export function vocabRows(entries: MemoryEntry[], v: MemoryVocab | undefined): { merges: { from: string; to: string; n: number }[]; aliases: { alias: string; tag: string }[] } {
  if (!v) return { merges: [], aliases: [] };
  const uses = (tag: string) => entries.filter(e => e.status !== 'rejected' && e.tags?.includes(tag)).length;
  return {
    merges: v.merges.map(m => ({ from: m.from, to: m.to, n: uses(m.from) })).sort((a, b) => (a.from < b.from ? -1 : 1)),
    aliases: Object.entries(v.aliases).map(([alias, tag]) => ({ alias, tag })).sort((a, b) => (a.alias < b.alias ? -1 : 1)),
  };
}
/** Live update of the vocabulary: only a higher version replaces the one shown. */
export const newerVocab = (cur: MemoryVocab | undefined, v: MemoryVocab) => !cur || v.version > cur.version ? v : cur;

/** Live update: an entry replaces the one with the same id only if its version is higher. */
export function upsertEntry(entries: MemoryEntry[], e: MemoryEntry): MemoryEntry[] {
  const i = entries.findIndex(x => x.id === e.id);
  if (i < 0) return [e, ...entries];
  if (entries[i].version >= e.version) return entries;
  return entries.map((x, k) => k === i ? e : x);
}
