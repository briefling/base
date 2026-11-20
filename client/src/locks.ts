// Agent hand and shared resources (parallel work): DOM-free logic, tested in client/test/locks.test.ts.
// The hub decides everything (who holds, who waits); the client only stores the highest `version` and reads it.
import type { AgentLock, ResourceLock, PublicThread } from '../../protocol/frames.ts';

/** Keeps the highest `version` per key (concurrent Lambdas: arrival order means nothing). True if stored. */
export function upsertVersioned<T extends { version: number }>(m: Map<string, T>, key: string, x: T): boolean {
  const cur = m.get(key);
  if (cur && cur.version >= x.version) return false;
  m.set(key, x);
  return true;
}
export const lockKey = (l: { space: string; agent: string }) => `${l.space}|${l.agent}`;
export const resourceKey = (r: { space: string; resource: string }) => `${r.space}|${r.resource}`;

/** A lock from a hub that still sends `holder` (before the parallel-work protocol) reads as a one-holder list. */
export function normalizeLock(l: AgentLock): AgentLock {
  if (Array.isArray(l.holders)) return l;
  const old = (l as unknown as { holder?: string | null }).holder;
  return { ...l, holders: old ? [old] : [] };
}

/** Place in a queue (1 = the next one), null if the thread is not in it. */
export const posIn = (queue: readonly string[] | undefined, id: string) => { const i = queue?.indexOf(id) ?? -1; return i < 0 ? null : i + 1; };

/** Resource the thread is parked on (hub state Waiting): the ResourceLock of its space whose queue holds it. */
export function parkedOn(resources: Iterable<ResourceLock>, f: Pick<PublicThread, 'id' | 'space' | 'kind'>): { lock: ResourceLock; pos: number } | null {
  if (f.kind === 'topic') return null;
  for (const r of resources) {
    const pos = r.space === f.space ? posIn(r.queue, f.id) : null;
    if (pos) return { lock: r, pos };
  }
  return null;
}

/** Where a thread waits for its turn: parked on a shared resource (read first, like the Waiting chip's tooltip) or in
 *  its agent's queue. `pos` 1 = the next one. Null when it is in no queue. */
export type Place = { on: 'agent' | 'resource'; name: string; pos: number };
export function placeOf(lock: AgentLock | null | undefined, resources: Iterable<ResourceLock>, f: Pick<PublicThread, 'id' | 'space' | 'kind'>): Place | null {
  if (f.kind === 'topic') return null;
  const p = parkedOn(resources, f);
  if (p) return { on: 'resource', name: p.lock.resource, pos: p.pos };
  const n = lock ? posIn(lock.queue, f.id) : null;
  return n ? { on: 'agent', name: lock!.agent, pos: n } : null;
}

/** Waiting section order (the next one was at the bottom): threads in a queue first, in order of passage (all the
 *  « 1st » on top, the agent's queue before a resource's, then by name), then the other Waiting threads by last activity. */
export function waitOrder<T extends { updatedAt: number }>(fs: readonly T[], place: (f: T) => Place | null): T[] {
  const ps = new Map(fs.map(f => [f, place(f)] as const));
  return [...fs].sort((a, b) => {
    const pa = ps.get(a), pb = ps.get(b);
    if (pa && pb) return pa.pos - pb.pos || (pa.on === pb.on ? 0 : pa.on === 'agent' ? -1 : 1) || pa.name.localeCompare(pb.name) || b.updatedAt - a.updatedAt;
    if (pa || pb) return pa ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

/** Resources this thread holds while other threads wait for them (holder banner), sorted by name. */
export const heldWithQueue = (resources: Iterable<ResourceLock>, f: Pick<PublicThread, 'id' | 'space'>) =>
  [...resources].filter(r => r.space === f.space && r.holder === f.id && r.queue.length).sort((a, b) => a.resource.localeCompare(b.resource));

/** A holder thread not mid-turn keeps one of the agent's places (until it is finished, closed or released) while nothing
 *  runs there: the « holds a slot » badge of the list cards. Topics never hold the hand. */
export const keepsPlace = (l: AgentLock | null | undefined, f: Pick<PublicThread, 'id' | 'kind' | 'state'>) =>
  f.kind !== 'topic' && f.state !== 'run' && !!l?.holders.includes(f.id);
