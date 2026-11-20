// Sidebar space list: active spaces on top, quiet ones below a light separator, the ones I muted last (folded group).
// DOM-free rule, tested in client/test.
import type { PublicThread } from '../../protocol/frames.ts';
import { busyCounts } from './busy.ts';

/** No activity for this long (ms) = inactive. A constant on purpose: easy to change, no setting. */
export const INACTIVE_AFTER = 48 * 3600_000;

type T = Pick<PublicThread, 'space' | 'kind' | 'state' | 'updatedAt' | 'archived' | 'memoryReview' | 'working'>;

/**
 * Splits the spaces into active / inactive, each group in alphabetical order (stable: no recency sort, the list
 * must not move under the pointer). Activity = latest `updatedAt` among the loaded threads and topics of the space
 * (the hidden memory review topic left out). Always active whatever the date:
 * - the open space (`open`);
 * - a space with a thread on Your turn (same count as the sidebar badge);
 * - a space where an agent is at work (busy dot);
 * - a space whose lists are not loaded yet (`unknown`: no data, so no verdict).
 * A space I muted (`muted`, client/src/mute.ts) goes to `muted` whatever its activity, open or not.
 */
export function spaceGroups<S extends { id: string; name: string }>(spaces: readonly S[], threads: Iterable<T>,
  o: { now: number; open: string | null; unknown?: ReadonlySet<string>; muted?: ReadonlySet<string> }): { active: S[]; inactive: S[]; muted: S[] } {
  const all = [...threads];
  const last = new Map<string, number>(), you = new Set<string>();
  for (const f of all) {
    if (f.memoryReview) continue;
    last.set(f.space, Math.max(last.get(f.space) ?? 0, f.updatedAt));
    if (!f.archived && f.kind !== 'topic' && f.state === 'you') you.add(f.space);
  }
  const isActive = (s: S) => {
    if (s.id === o.open || you.has(s.id) || o.unknown?.has(s.id)) return true;
    const b = busyCounts(all as PublicThread[], s.id);
    if (b.threads || b.topics) return true;
    return o.now - (last.get(s.id) ?? 0) < INACTIVE_AFTER;
  };
  const byName = (a: S, b: S) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  const active: S[] = [], inactive: S[] = [], muted: S[] = [];
  for (const s of spaces) (o.muted?.has(s.id) ? muted : isActive(s) ? active : inactive).push(s);
  return { active: active.sort(byName), inactive: inactive.sort(byName), muted: muted.sort(byName) };
}
