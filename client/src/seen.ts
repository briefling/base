// Read marks (thread -> `updatedAt` read). The hub keeps them per person; localStorage is the offline cache.
// Both sides only move forward, so merging is a max and two devices converge whatever the order.
import { SEEN_MAX, type SeenMark } from '../../protocol/frames.ts';

export type Marks = Record<string, number>;

/** Takes every hub mark more recent than the local one. True if `local` changed. */
export function mergeMarks(local: Marks, hub: SeenMark[]): boolean {
  let changed = false;
  for (const m of hub) if ((local[m.thread] ?? 0) < m.at) { local[m.thread] = m.at; changed = true; }
  return changed;
}

/**
 * Sync of a page of threads: hub marks first, then the first-run rule (a thread with no mark at all, neither here
 * nor on the hub, counts as read), then the local marks the hub lacks or has older (first connection after the
 * hub learned marks, frames lost offline), in frames of SEEN_MAX. Returns whether `local` changed and what to send.
 */
export function syncMarks(local: Marks, hub: SeenMark[], threads: { id: string; updatedAt: number }[], firstRun: boolean): { changed: boolean; upload: SeenMark[][] } {
  let changed = mergeMarks(local, hub);
  if (firstRun) for (const f of threads) if (!(f.id in local)) { local[f.id] = f.updatedAt; changed = true; }
  const onHub = new Map(hub.map(m => [m.thread, m.at]));
  const up = [...new Set(threads.map(f => f.id))].filter(id => id in local && local[id] > (onHub.get(id) ?? 0)).map(id => ({ thread: id, at: local[id] }));
  const upload: SeenMark[][] = [];
  for (let i = 0; i < up.length; i += SEEN_MAX) upload.push(up.slice(i, i + SEEN_MAX));
  return { changed, upload };
}

/** Marks `f` read up to its `updatedAt`. Returns the mark to send to the hub, null if it was already read. */
export function markRead(local: Marks, f: { id: string; updatedAt: number }): SeenMark | null {
  if ((local[f.id] ?? 0) >= f.updatedAt) return null;
  local[f.id] = f.updatedAt;
  return { thread: f.id, at: f.updatedAt };
}
