// Shared resources of a space (Settings › Parallel work): `acquire_resource` queues the thread or grants the resource,
// the end of a turn or `release_resource` frees it and hands it to the next parked thread, which is resumed. The router
// keeps the dispatch (`resource.acquire`, `resource.release`) and the turn gates it runs before calling here.
import { RESOURCE_RE, type HubFrame, type Message } from '../../protocol/frames.ts';
import { logEvent } from './details.ts';
import { queuedNow } from './queuetalk.ts';
import { type Deps, type Space, type StoredResource, type StoredThread, boardDriven, broadcast, deliver, mutateThread, need, omit, parallelOf, publicResource, publicThread, str, turnAuthor } from './router.ts';

/** Read-modify-write of a shared resource, optimistic lock, 3 attempts. Returns the record as written (or as read when `fn` changes nothing). */
export async function mutateResource(deps: Deps, space: string, resource: string, fn: (r: StoredResource) => StoredResource | null): Promise<StoredResource> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await deps.store.getResource(space, resource);
    const base: StoredResource = cur ?? { space, resource, holder: null, agent: null, queue: [], since: 0, version: 0, by: {} };
    const n = fn(base);
    if (!n) return base;
    const next = { ...n, version: base.version + 1 };
    if (!(await deps.store.putResource(next, cur ? cur.version : null))) continue;
    await broadcast(deps, space, { v: 2, type: 'event', event: 'resource.updated', data: publicResource(next) });
    return next;
  }
  throw new Error('resource_conflict');
}

/**
 * `acquire_resource` tool: the agent takes a shared resource right before using it. Safeguards: threads only, during a
 * turn triggered by a trusted human, resource declared by the admin (the agent never invents one). Busy: the thread is
 * parked (Waiting, no "Your turn"), the agent ends its turn; the hub resumes it when the resource is its own.
 * Cooperative by nature: nothing stops an agent from using a resource without acquiring it (assumed).
 */
export async function acquire(deps: Deps, thread: StoredThread, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && typeof f.resource === 'string' && RESOURCE_RE.test(f.resource));
  need(thread.kind !== 'topic', 'not_thread');
  need(thread.facts.turnActive, 'no_turn');
  const space = await deps.store.getSpace(thread.space); need(!!space, 'forbidden');
  need(!boardDriven(space!), 'board_driven');
  need(!(await queuedNow(deps, thread)), 'queued'); // a talk turn while queued: Lounge rights, no shared resource
  need(parallelOf(space!).resources.includes(f.resource), 'unknown_resource');
  const by = await turnAuthor(deps, space!, thread); need(!!by, 'no_turn');
  let granted = false, holder: string | null = null, position = 0, changed = false;
  await mutateResource(deps, space!.id, f.resource, r => {
    granted = false; holder = null; position = 0; changed = false;
    if (r.holder === thread.id) { granted = true; return null; }
    changed = true;
    if (r.holder === null) { granted = true; return { ...r, holder: thread.id, agent: thread.owner, queue: r.queue.filter(x => x !== thread.id), by: omit(r.by, thread.id), since: deps.now() }; }
    holder = r.holder;
    const i = r.queue.indexOf(thread.id);
    if (i >= 0) { position = i + 1; changed = false; return null; }
    position = r.queue.length + 1;
    return { ...r, queue: [...r.queue, thread.id], by: { ...r.by, [thread.id]: by! } };
  });
  if (changed) await logEvent(deps, thread, { at: deps.now(), kind: 'resource', resource: f.resource, op: granted ? 'acquired' : 'queued' });
  if (!granted) {
    const t = await mutateThread(deps, thread.id, { type: 'parked', resource: f.resource });
    await broadcast(deps, t.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t) });
  }
  const title = holder ? (await deps.store.getThread(holder))?.title ?? 'another thread' : undefined;
  await reply({ v: 2, type: 'resource.result', client_id: f.client_id, resource: f.resource, granted, ...(granted ? {} : { holder: title, position }) });
}

/** The thread frees the resources it holds (`held`) and/or leaves the resource queues (`queued`); the freed ones go to the next thread. */
export async function freeResources(deps: Deps, space: Space, thread: string, what: { held: boolean; queued: boolean }) {
  const all = await deps.store.listResources(space.id);
  if (!all.length) return;
  let unpark = false;
  for (const r of all) {
    const holds = what.held && r.holder === thread, queued = what.queued && r.queue.includes(thread);
    if (!holds && !queued) continue;
    let freed = false;
    await mutateResource(deps, space.id, r.resource, x => {
      const held = what.held && x.holder === thread, q = what.queued && x.queue.includes(thread);
      freed = held;
      if (!held && !q) return null;
      return { ...x, ...(held ? { holder: null, agent: null, since: deps.now() } : {}), ...(q ? { queue: x.queue.filter(y => y !== thread), by: omit(x.by, thread) } : {}) };
    });
    if (freed) await logEvent(deps, { id: thread }, { at: deps.now(), kind: 'resource', resource: r.resource, op: 'released' });
    if (queued) unpark = true;
  }
  if (unpark) { // out of every queue: no longer Waiting for a resource
    const t = await deps.store.getThread(thread);
    if (t?.facts.parked) {
      const next = await mutateThread(deps, thread, { type: 'parked', resource: null });
      await broadcast(deps, next.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
    }
  }
  await pumpAll(deps, space);
}

/** Every free resource with a queue goes to its next thread (whose turn has ended). */
async function pumpAll(deps: Deps, space: Space) {
  for (const r of await deps.store.listResources(space.id)) if (!r.holder && r.queue.length) await pump(deps, space, r.resource);
}

/**
 * A free resource goes to the first parked thread of its queue: the hub grants it, then resumes the thread with a
 * message attributed to the trusted human who triggered the parked turn (like the handover of the hand). A thread still
 * mid-turn keeps the head of the queue: its turn end pumps again. A thread put away or no longer parked on it is dropped.
 */
export async function pump(deps: Deps, space: Space, resource: string) {
  for (let i = 0; i < 20; i++) {
    const r = await deps.store.getResource(space.id, resource);
    if (!r || r.holder || !r.queue.length) return;
    const [head, ...rest] = r.queue;
    const t = await deps.store.getThread(head);
    const valid = !!t && t.space === space.id && !t.archived && !t.facts.manual && t.facts.parked === resource;
    if (valid && t!.facts.turnActive) return;
    const next: StoredResource = valid ? { ...r, holder: head, agent: t!.owner, queue: rest, by: omit(r.by, head), since: deps.now(), version: r.version + 1 }
      : { ...r, queue: rest, by: omit(r.by, head), version: r.version + 1 };
    if (!(await deps.store.putResource(next, r.version))) continue;
    await broadcast(deps, space.id, { v: 2, type: 'event', event: 'resource.updated', data: publicResource(next) });
    if (valid) await logEvent(deps, t!, { at: deps.now(), kind: 'resource', resource, op: 'acquired' });
    if (valid) return await resume(deps, space, t!, resource, r.by[head]);
  }
}

/** The parked thread now holds `resource`: the agent picks up where it stopped. Message not stored (like the kickoff). */
async function resume(deps: Deps, space: Space, thread: StoredThread, resource: string, by: string) {
  const t = await mutateThread(deps, thread.id, { type: 'parked', resource: null });
  await broadcast(deps, t.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(t) });
  const last = await deps.store.lastMessages(thread.id, 30);
  const since = last.findLastIndex(m => m.author.kind === 'agent');
  const go: Message = { id: deps.newId(), thread: thread.id, author: { kind: 'human', id: by }, type: 'text', at: deps.now(),
    text: `briefling: the resource ${resource} you were waiting for is now yours. Resume the paused work and use it now; it is released at the end of this turn (or with release_resource).` };
  await deliver(deps, space, t, go, last.slice(since + 1));
}

/** Resources removed from the settings: their queues are emptied (threads no longer parked), the holder keeps it until its turn ends. */
export async function dropResources(deps: Deps, space: Space) {
  const kept = parallelOf(space).resources;
  for (const r of await deps.store.listResources(space.id)) {
    if (kept.includes(r.resource) || !r.queue.length) continue;
    await mutateResource(deps, space.id, r.resource, x => x.queue.length ? { ...x, queue: [], by: {} } : null);
    for (const id of r.queue) {
      const t = await deps.store.getThread(id);
      if (t?.facts.parked !== r.resource) continue;
      const next = await mutateThread(deps, id, { type: 'parked', resource: null });
      await broadcast(deps, next.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
    }
  }
}
