// Threads born from a topic, counted by state for the badges of its Lounge card. DOM-free (tested by node).
import { FAMILY_DEPTH, type PublicThread, type ThreadState } from '../../protocol/frames.ts';
import { agentDone, finished } from './shelves.ts';

/** Badge order on the card; `wait` gathers Waiting and Quiet, `done` = what the Closed list holds: closed, the agent said ✓ done (Quiet + outcome done), archived. */
export const SPAWN_BUCKETS = ['run', 'you', 'wait', 'idea', 'done'] as const;
export type SpawnBucket = typeof SPAWN_BUCKETS[number];
export interface SpawnCount { bucket: SpawnBucket; n: number }

const BUCKET: Record<ThreadState, SpawnBucket> = { run: 'run', you: 'you', wait: 'wait', calm: 'wait', idea: 'idea', done: 'done' };

/**
 * `ids` = the topic's `spawned`; `get` = the threads the client knows (the hub joins a topic's threads to the page that
 * carries it, so old ones are there too); `shownOf` = the displayed state (a queued Quiet thread shows Waiting).
 * An id the client doesn't know (deleted, or beyond the hub's bound) is not counted. Buckets at 0 are left out.
 */
export function spawnedCounts(ids: string[], get: (id: string) => PublicThread | undefined, shownOf: (f: PublicThread) => ThreadState): SpawnCount[] {
  const n = new Map<SpawnBucket, number>();
  for (const id of new Set(ids)) {
    const f = get(id);
    if (!f) continue;
    const b = f.archived || finished(f) ? 'done' : BUCKET[shownOf(f)];
    n.set(b, (n.get(b) ?? 0) + 1);
  }
  return SPAWN_BUCKETS.filter(b => n.get(b)).map(b => ({ bucket: b, n: n.get(b)! }));
}

/** State mark of a thread line on a Lounge topic card (« checklist », Nov 6): `done` merges « ✓ done » (the
 *  agent said done while Quiet as shown), Closed and archived; `run` = in progress as shown (a turn, a work column or
 *  background work); `you` = my turn; `wait` = Waiting as shown (queued behind the agent, someone else's turn), drawn
 *  apart from Quiet (a queued thread looked quiet); `later` = set aside for later, drawn as the clock of
 *  the Later entry and filter (it looked like Quiet); `archived` = archived, greyed with the archive icon
 *  (it looked closed), still counted finished; `idle` = the rest (quiet). */
export type RowMark = 'done' | 'archived' | 'run' | 'you' | 'wait' | 'later' | 'idle';
/** Marks counted finished in a topic's counter and folded into its « ✓ n » mark. */
export const finishedMark = (m: RowMark) => m === 'done' || m === 'archived';
/** What the chip of a thread's link card says (thread opened from a card, issue created): « Archived » once archived,
 *  like the lists and the topic header count (`rowMark`), else the thread's state chip. */
export function linkChip(f: Pick<PublicThread, 'archived'>): 'archived' | 'state' {
  return f.archived ? 'archived' : 'state';
}

export function rowMark(f: Pick<PublicThread, 'state' | 'outcome' | 'archived'>, shown: ThreadState): RowMark {
  if (f.archived) return 'archived';
  if (f.state === 'done' || agentDone(shown, f)) return 'done';
  if (shown === 'idea') return 'later';
  return shown === 'run' || shown === 'you' || shown === 'wait' ? shown : 'idle';
}
/** « finished/total » counter next to the topic's title; null without any thread (no counter). */
export function markCount(marks: RowMark[]): { done: number; total: number } | null {
  return marks.length ? { done: marks.filter(finishedMark).length, total: marks.length } : null;
}
/** Marks drawn in a topic's bubble: from `min` marks on, the finished ones fold into ONE leading mark carrying their
 *  number (« ✓ 7 », Blair, Nov 12: 8 green dots ate the bubble); below it, or with nothing finished, one mark each. */
export interface DotMark { mark: RowMark; n?: number }
export const DOTS_FOLD_AT = 5;
export function dotMarks(marks: RowMark[], min = DOTS_FOLD_AT): DotMark[] {
  const done = marks.filter(finishedMark).length;
  if (marks.length < min || !done) return marks.map(mark => ({ mark }));
  return [{ mark: 'done', n: done }, ...marks.filter(m => !finishedMark(m)).map(mark => ({ mark }))];
}

export interface FamilyRow { f: PublicThread; depth: number }
/**
 * Every thread opened from `root`, then from those threads, and so on (a thread opened from a thread lands in the
 * parent thread's `spawned`, not in the topic's): depth-first, each thread right after its parent, `depth` 1 for a
 * direct child. Guards: an id seen once is never walked again (cycle, or the same thread listed twice), at most
 * `max` levels; an id the client doesn't know is skipped with its descendants.
 */
export function topicFamily(root: Pick<PublicThread, 'id' | 'spawned'>, get: (id: string) => PublicThread | undefined, max = FAMILY_DEPTH): FamilyRow[] {
  const out: FamilyRow[] = [], seen = new Set([root.id]);
  const walk = (ids: string[] | undefined, depth: number) => {
    if (depth > max) return;
    for (const id of ids ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const f = get(id);
      if (!f) continue;
      out.push({ f, depth });
      walk(f.spawned, depth + 1);
    }
  };
  walk(root.spawned, 1);
  return out;
}
/** Ids of the whole family, for `spawnedCounts`. */
export const familyIds = (root: Pick<PublicThread, 'id' | 'spawned'>, get: (id: string) => PublicThread | undefined) => topicFamily(root, get).map(x => x.f.id);
