// Floating « N unread · M unread topics ↑/↓ » pill of the Bar feed, above its composer. It counts the
// Bar's unread messages (one block, its « New messages » line: `unreadMark`) and the topic cards marked unread (their
// dot), and each tap takes the reader to the next of them in reading order, oldest first. A card fully on screen
// counts as reached (main.ts `fabSeen`: on scroll, and on arrival when the feed is at the bottom). DOM-free, tested in
// client/test/unreadfab.test.ts; main.ts does the scrolling and keeps what was already reached.
import type { UnreadMark } from './unread.ts';

/** A topic card of the feed: its place in the feed (`FeedItem.at`) and its unread dot. */
export interface FabTopic { id: string; at: number; unread: boolean }
export type FabTarget = { kind: 'msgs' } | { kind: 'topic'; id: string };
/** `msgs`: unread Bar messages still to reach (`more`: the first one is older than the loaded page, « n+ »);
 *  `topics`: unread topic cards still to reach; `next`: where the next tap goes. */
export interface Fab { msgs: number; more: boolean; topics: number; next: FabTarget }

/**
 * `mark`: the Bar's unread mark (null in « Topics only » or before the history is loaded). `msgsDone`: the
 * « New messages » line was already reached (tapped or scrolled into view) during this visit. `done`: topic cards
 * already reached during this visit (they keep their dot until opened, but no longer count). Null = nothing left:
 * no pill.
 */
export function unreadFab(mark: UnreadMark | null, msgsDone: boolean, topics: readonly FabTopic[], done: ReadonlySet<string>): Fab | null {
  const msgs = mark?.n && !msgsDone ? mark : null;
  const left = topics.filter(x => x.unread && !done.has(x.id));
  if (!msgs && !left.length) return null;
  // The line may sit before the loaded page (`more`): it is then the oldest of all, reached by paging back.
  const msgsAt = msgs ? (msgs.more || msgs.firstAt === null ? -Infinity : msgs.firstAt) : Infinity;
  const first = left.reduce<FabTopic | null>((a, x) => !a || x.at < a.at ? x : a, null);
  const next: FabTarget = msgs && (!first || msgsAt <= first.at) ? { kind: 'msgs' } : { kind: 'topic', id: first!.id };
  return { msgs: msgs?.n ?? 0, more: !!msgs?.more, topics: left.length, next };
}

/** The pill's arrow: where its next target sits against the feed's visible box (« 2 active topics ↓ »
 *  while both cards were above). `target` null = not rendered yet: older than the loaded page, so above. A target
 *  starting above the box's top is up, anything else down (a tap scrolls it to the top of the box). */
export function fabDir(target: { top: number } | null, view: { top: number }): 'up' | 'down' {
  return !target || target.top < view.top ? 'up' : 'down';
}
