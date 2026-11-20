// The Lounge as one feed: the messages of the Bar (General) and the space's topics in a
// single timeline, oldest first, each topic as a card at its creation time. DOM-free, tested in client/test/feed.test.ts.
// Two paginated sources feed it: General's history (`history { before }`, by message time) and the space's thread
// pages (`threads.page`, by last activity). `buildFeed` cuts the timeline at the most recent of their two edges, so a
// scroll up never shows a gap that a later page would fill, nor an item twice.
import type { Message, PublicThread } from '../../protocol/frames.ts';
import { GAP_LOUNGE, groupsUnder, type Groupable } from './grouping.ts';

/**
 * Creation time carried by a hub id: `newId` = `Date.now()` in base 36 + 12 random characters (hub/src/aws.ts); a topic
 * opened from a General message is `<msg>-t`, so it carries the message's time. null when the id is not of that shape
 * (fixtures, very old ids): the caller falls back to another time.
 */
export function idTime(id: string): number | null {
  const head = id.split('-')[0];
  if (head.length <= 12 || !/^[0-9a-z]+$/.test(head)) return null;
  const n = parseInt(head.slice(0, -12), 36);
  return n > 1.5e12 && n < 4.1e12 ? n : null; // 2017 … 2099: anything else is not a timestamp
}

/** `src`: the Bar message a topic was opened from, when loaded (its author line). */
export type FeedItem = { kind: 'msg'; at: number; m: Message } | { kind: 'topic'; at: number; f: PublicThread; src?: Message };

/**
 * What is not loaded yet, per source. `msgs`: time of the oldest General message loaded while older ones remain
 * (null = the start of General is loaded, or there is no General). `topics`: time of the thread-page cursor while
 * pages remain (null = every thread is loaded). Every topic created after `topics` is loaded: its last activity is at
 * least its creation time, and the pages hold everything active after the cursor.
 */
export interface FeedEdge { msgs: number | null; topics: number | null }

export interface Feed {
  /** Oldest first. */
  items: FeedItem[];
  /** Items older than this are held back (null = nothing held back): the top of the feed shows the loading sentinel. */
  floor: number | null;
  /** Which source(s) to page when the sentinel shows: the one(s) whose edge is the floor. */
  load: { msgs: boolean; topics: boolean };
}

/**
 * `msgs` = General's loaded messages; `topics` = the topics listed in the Lounge (live, not archived, General
 * excluded: `loungeTopics`). A General message whose topic is listed is replaced by that topic's card at the
 * message's time; a topic started with « + Topic » shows at its creation time, with no message made up for it. A
 * message whose topic is not listed (archived, not loaded) stays a message with its « → topic » link.
 */
export function buildFeed(msgs: Iterable<Message>, topics: Iterable<PublicThread>, edge: FeedEdge): Feed {
  const listed = new Map([...topics].map(f => [f.id, f]));
  // Either side may arrive first: the message's `subtopic` or the topic's `fromMsg`.
  const replaced = new Set([...listed.values()].map(f => f.fromMsg).filter((x): x is string => !!x));
  const byId = new Map<string, Message>();
  const items: FeedItem[] = [];
  for (const m of msgs) {
    byId.set(m.id, m);
    if (!(m.subtopic && listed.has(m.subtopic)) && !replaced.has(m.id)) items.push({ kind: 'msg', at: m.at, m });
  }
  for (const f of listed.values()) {
    const src = f.fromMsg ? byId.get(f.fromMsg) : undefined;
    items.push({ kind: 'topic', at: src?.at ?? idTime(f.fromMsg ?? f.id) ?? f.updatedAt, f, ...(src ? { src } : {}) });
  }
  const edges = [edge.msgs, edge.topics].filter((x): x is number => x !== null);
  const floor = edges.length ? Math.max(...edges) : null;
  const kept = floor === null ? items : items.filter(x => x.at >= floor);
  kept.sort((a, b) => a.at - b.at || keyOf(a).localeCompare(keyOf(b)));
  return { items: kept, floor, load: { msgs: floor !== null && edge.msgs === floor, topics: floor !== null && edge.topics === floor } };
}
const keyOf = (x: FeedItem) => x.kind === 'msg' ? x.m.id : x.f.id;

/**
 * Items of the « All » feed shown grouped under the one before (no avatar nor name, the time in the margin). A topic
 * card counts as a message of its author (its Bar message's, else the topic's `author`), so it neither breaks a run nor
 * always repeats the name (« A »): grouping lasts while nobody else writes, up to `gap` between two items.
 */
export function feedGrouped(items: readonly FeedItem[], gap = GAP_LOUNGE): Set<FeedItem> {
  const out = new Set<FeedItem>();
  let prev: Groupable | null = null;
  for (const x of items) {
    if (x.kind === 'msg' && x.m.notice) continue; // a gateway notice is a grey line: it neither groups nor breaks a run
    const cur: Groupable = x.kind === 'msg' ? { author: x.m.author, at: x.at, lead: x.m.type === 'text' }
      : { author: x.src?.author ?? (x.f.author ? { kind: x.f.authorAgent ? 'agent' : 'human', id: x.f.author } : null), at: x.at, lead: true };
    if (groupsUnder(prev, cur, gap)) out.add(x);
    prev = cur;
  }
  return out;
}

/**
 * Plugin-update notices of the hub that follow each other in the feed toward the same version (« B »): the
 * instances update seconds apart, one line each, so the client shows one line per run. Other notices between them do
 * not break a run, anything else does. `runs`: id of the run's first message → every message of the run, oldest first;
 * `hidden`: the others, not drawn. Notices stored before the `plugin` field (text only) are never merged.
 */
export function pluginRuns(items: readonly FeedItem[]): { runs: Map<string, Message[]>; hidden: Set<string> } {
  const runs = new Map<string, Message[]>(), hidden = new Set<string>();
  let cur: Message[] | null = null;
  for (const x of items) {
    if (x.kind === 'msg' && x.m.plugin) {
      if (cur && cur[0].plugin!.to === x.m.plugin.to) { cur.push(x.m); hidden.add(x.m.id); }
      else runs.set(x.m.id, cur = [x.m]);
    } else if (!(x.kind === 'msg' && x.m.notice)) cur = null;
  }
  return { runs, hidden };
}

/** What a run says: its version, its agents (each once, in order) and the versions they came from (each once). */
export function pluginRunInfo(run: readonly Message[]): { to: string; agents: string[]; from: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return { to: run[0].plugin!.to, agents: uniq(run.flatMap(m => m.plugin!.agents)), from: uniq(run.map(m => m.plugin!.from)) };
}

/** « Milan, Gideon, Radar +2 »: the first `max` names, then how many more. */
export function namesPlus(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}
