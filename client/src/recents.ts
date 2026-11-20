// « Recents »: the topics of a space on a rail, the threads opened from each as branches
// (a thread opened from a thread one notch under its parent), like a vertical git graph. DOM-free, tested in
// client/test/recents.test.ts; laid out by client/src/recentsview.ts. The Lounge feed stays chronological: this pane
// is a view of its own, so it sorts by activity.
import type { PublicThread } from '../../protocol/frames.ts';
import { fold } from '../../protocol/search.ts';
import { loungeTopics, topicName } from './lounge.ts';
import { topicFamily, type RowMark } from './spawned.ts';

export type RecentsFilter = 'all' | 'active' | 'unread';
export const RECENTS_FILTERS: readonly RecentsFilter[] = ['all', 'active', 'unread'];

export interface RecentsOpts {
  filter: RecentsFilter;
  /** Free text: a row whose title (or an ancestor's) holds every folded word. */
  q: string;
  unread(f: PublicThread): boolean;
  /** Moving now as shown (in progress, my turn, waiting): « Active ». */
  active(f: PublicThread): boolean;
}

export interface RecentRow {
  f: PublicThread;
  /** 0 = on the rail (a topic, or a thread whose origin is not known here), 1 = opened from it, and so on. */
  depth: number;
  /** Rail rows: last activity of the whole branch; branch rows: their own. */
  at: number;
  /** Shown only as the parent of a match (filter or text): faded. */
  ctx: boolean;
  /** Rail rows: threads of the whole branch (all of them, whatever the filter). */
  kids: number;
  /** Columns crossed top to bottom by a vertical line (a later sibling of an ancestor, or the rail going on). */
  rails: number[];
  /** A line leaves the node downwards (its first child follows, or the rail goes on to the next topic). */
  down: boolean;
}

interface Branch { root: PublicThread; rows: { f: PublicThread; depth: number }[]; at: number }

/** Every branch of `space` (all spaces when undefined), the most recently active first. Rail = live topics (General
 *  excluded) and the threads no loaded topic or thread lists in its `spawned` (opened from the Threads list, or whose
 *  topic is on a page not loaded yet), archived ones left out; archived threads inside a branch stay (shown done). */
function branches(all: Iterable<PublicThread>, space: string | undefined): Branch[] {
  const list = [...all].filter(f => space === undefined || f.space === space);
  const byId = new Map(list.map(f => [f.id, f]));
  const get = (id: string) => byId.get(id);
  const spaces = space === undefined ? [...new Set(list.map(f => f.space))] : [space];
  const topics = spaces.flatMap(s => loungeTopics(list, s));
  const covered = new Set<string>();
  for (const t of topics) for (const x of topicFamily(t, get)) covered.add(x.f.id);
  // Threads outside every topic: those also listed by another such thread hang under it, the rest go on the rail.
  const loose = list.filter(f => f.kind !== 'topic' && !covered.has(f.id) && !f.archived);
  const under = new Set<string>();
  for (const f of loose) for (const x of topicFamily(f, get)) under.add(x.f.id);
  const roots = [...topics, ...loose.filter(f => !under.has(f.id))];
  return roots.map(root => {
    const rows = [{ f: root, depth: 0 }, ...topicFamily(root, get)];
    return { root, rows, at: Math.max(...rows.map(r => r.f.updatedAt)) };
  }).sort((a, b) => b.at - a.at || (a.root.id < b.root.id ? 1 : a.root.id > b.root.id ? -1 : 0));
}

const nameOf = (f: PublicThread) => f.kind === 'topic' ? topicName(f) : f.title;
const tokens = (q: string) => fold(q).split(/\s+/).filter(Boolean);
/** Free-text words of the filter (the `#tag` ones apart). */
const words = (q: string) => tokens(q).filter(w => !w.startsWith('#'));
/** `#tag` words of the filter, without the `#` (a lone `#` is ignored). */
export const tagTerms = (q: string) => tokens(q).filter(w => w.startsWith('#') && w.length > 1).map(w => w.slice(1));
/** Tags of a conversation (protocol/tags.ts), none when unset. */
export const tagsOf = (f: PublicThread): string[] => f.tags?.list ?? [];

/** What a row's classes depend on besides the row itself. */
export interface RowLook { unread: boolean; mark: RowMark; mine: boolean; sel: boolean }

/** Classes of a Recents / Now row. The title is grey once read and bright bold while unread, except a conversation at
 *  your turn (`you`) or in progress (`rc-run`, the working mark): its title stays bright even read (an
 *  active conversation must not look dimmed). Archived (`rc-arch`) and context rows (`ctx`) keep their fade. */
export const rowClass = (r: Pick<RecentRow, 'f' | 'depth' | 'ctx'>, o: RowLook): string =>
  [`rc-row d${r.depth}`, r.depth && tagsOf(r.f).length ? 'tagged' : '', r.ctx ? 'ctx' : '', o.unread ? 'unread' : '',
    o.mark === 'you' ? 'you' : '', o.mark === 'run' ? 'rc-run' : '', o.mark === 'archived' ? 'rc-arch' : '', o.mine ? 'mine' : '',
    o.sel ? 'sel' : ''].filter(Boolean).join(' ');

/** Number of tag tints in client/style.css (`.tgh0`..`.tgh7`). */
export const TAG_HUES = 8;
/** Tint class of a tag, stable across sessions and clients: FNV-1a 32-bit of its UTF-16 units, modulo TAG_HUES. */
export function tagHue(tag: string): string {
  let n = 2166136261;
  for (let i = 0; i < tag.length; i++) n = Math.imul(n ^ tag.charCodeAt(i), 16777619);
  return `tgh${(n >>> 0) % TAG_HUES}`;
}

/** The filter with `#tag` added, or removed when it is there (a pill or a filter of the bar toggles it). */
export function toggleTag(q: string, tag: string): string {
  const parts = q.split(/\s+/).filter(Boolean), on = parts.some(w => fold(w) === `#${tag}`);
  return (on ? parts.filter(w => fold(w) !== `#${tag}`) : [...parts, `#${tag}`]).join(' ');
}

/** Tags used in the space's branches, most used first then by name: the filter bar of the pane. */
export function recentsTags(all: Iterable<PublicThread>, space: string): string[] {
  const n = new Map<string, number>();
  for (const b of branches(all, space)) for (const r of b.rows) for (const t of tagsOf(r.f)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([t]) => t);
}

/** The pane's rows, top to bottom: each branch is its topic then its threads depth-first, each thread right after its
 *  parent, siblings in creation order (`spawned` is appended to as threads open: the order of the feed's checklist).
 *  `space` undefined = every space (Now). */
export function recentsTree(all: Iterable<PublicThread>, space: string | undefined, o: RecentsOpts): RecentRow[] {
  const ws = words(o.q), tags = tagTerms(o.q);
  const hits = (f: PublicThread) => { const n = fold(nameOf(f)); return ws.every(w => n.includes(w)); };
  // A `#tag` matches the row's own tags (a prefix, while it is being typed); its parents stay as context.
  const tagged = (f: PublicThread) => tags.every(t => tagsOf(f).some(x => x.startsWith(t)));
  const pass = (f: PublicThread) => o.filter === 'all' || (o.filter === 'unread' ? o.unread(f) : o.active(f));
  const out: Omit<RecentRow, 'rails' | 'down'>[] = [];
  for (const b of branches(all, space)) {
    const keep = new Map<number, boolean>(); // row index -> matched itself (false = kept as context)
    const stack: number[] = [];               // index of the ancestor at each depth
    const textOk: boolean[] = [];
    b.rows.forEach((r, i) => {
      stack.length = r.depth; stack[r.depth] = i;
      textOk[i] = !ws.length || hits(r.f) || (r.depth > 0 && textOk[stack[r.depth - 1]]);
      if (!textOk[i] || !tagged(r.f) || !pass(r.f)) return;
      keep.set(i, true);
      for (let d = 0; d < r.depth; d++) if (!keep.has(stack[d])) keep.set(stack[d], false);
    });
    b.rows.forEach((r, i) => {
      if (!keep.has(i)) return;
      out.push({ f: r.f, depth: r.depth, at: r.depth ? r.f.updatedAt : b.at, ctx: !keep.get(i), kids: r.depth ? 0 : b.rows.length - 1 });
    });
  }
  return out.map((r, i) => ({ ...r, ...lanes(out, i) }));
}

/** Lines of row `i`: column c is crossed when the next row at depth ≤ c+1 sits at c+1 (a later sibling of the ancestor
 *  on that column), column 0 also when the rail goes on to a later topic. */
function lanes(rows: { depth: number }[], i: number): { rails: number[]; down: boolean } {
  const d = rows[i].depth, rails: number[] = [];
  for (let c = 0; c < d; c++) {
    const j = rows.findIndex((r, k) => k > i && r.depth <= c + 1);
    if (j >= 0 && (rows[j].depth === c + 1 || c === 0)) rails.push(c);
  }
  return { rails, down: d === 0 ? i < rows.length - 1 : i + 1 < rows.length && rows[i + 1].depth > d };
}

/** Unread conversations of the pane (its « Unread » count and the Recents button's badge). */
export const recentsUnread = (all: Iterable<PublicThread>, space: string, unread: (f: PublicThread) => boolean): number =>
  branches(all, space).reduce((n, b) => n + b.rows.filter(r => unread(r.f)).length, 0);

export interface FlatRecent { f: PublicThread; /** Rail conversation of its branch (a thread's topic), none for a rail row. */ root?: PublicThread }
/** ⌘K opened with nothing typed: the same conversations without the tree, each by its own last activity (the one
 *  touched last first), `limit` at most. `space` undefined = every space (from Now). */
export function recentsFlat(all: Iterable<PublicThread>, space: string | undefined, limit = 30): FlatRecent[] {
  return branches(all, space).flatMap(b => b.rows.map(r => r.depth ? { f: r.f, root: b.root } : { f: r.f }))
    .sort((a, b) => b.f.updatedAt - a.f.updatedAt || (a.f.id < b.f.id ? 1 : -1)).slice(0, limit);
}

/** « Now »: the Recents tree of every space, Active rows only (plus my turns, whatever their state),
 *  the branches holding one of my turns first, each group keeping its activity order. Same rows as the pane, so the
 *  view draws them the same way. A space I muted (`muted`, client/src/mute.ts) only brings my turns. */
export function nowTree(all: Iterable<PublicThread>, o: Pick<RecentsOpts, 'unread' | 'active'>, mine: (f: PublicThread) => boolean, muted?: ReadonlySet<string>): RecentRow[] {
  const rows = recentsTree(all, undefined, { filter: 'active', q: '', unread: o.unread, active: f => (o.active(f) && !muted?.has(f.space)) || mine(f) });
  const bs: RecentRow[][] = [];
  for (const r of rows) if (r.depth === 0) bs.push([r]); else bs[bs.length - 1].push(r);
  const has = (b: RecentRow[]) => b.some(r => !r.ctx && mine(r.f));
  const flat = [...bs.filter(has), ...bs.filter(b => !has(b))].flat();
  return flat.map((r, i) => ({ ...r, ...lanes(flat, i) }));
}
