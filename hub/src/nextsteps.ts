// « Open the thread » on a line « Next » of a thread's summary: a lead turns a next step the summary
// gives to an agent into a thread of that thread's agent, without retyping it. The line keeps its trace
// (`Thread.nextOpened`, keyed by its text): the button turns into a link, a second click (or a second tab) gets the
// same thread back. The line « Remind me » of a human's step is client-only (a `reminder.save` of the Reminders module).
// A module without on/off of its own, plugged in through hub/src/modules.ts; the « threads » module gates it.
import { NEXT_OPENED_MAX, type HubFrame, type Message, type Principal } from '../../protocol/frames.ts';
import { type Deps, type Space, type StoredThread, agentsOf, broadcast, deliver, id, memberSpace, modOn, mutateThread, need, publicThread, str, take } from './router.ts';
import type { HubModule } from './modules.ts';
import { leadId } from '../../protocol/leads.ts';
import { dropLead } from './leads.ts';

type Reply = (f: HubFrame) => Promise<boolean>;

/** What the agent gets (not stored: the thread shows the line, in the lead's name): the line, where it comes from, how to read more. */
export function nextGo(thread: StoredThread, origin: { id: string; title: string }, by: string, first: Message, deps: Pick<Deps, 'newId' | 'now'>): Message {
  return { id: deps.newId(), thread: thread.id, author: { kind: 'human', id: by }, type: 'text', at: deps.now(),
    text: `${first.text}\n\nThread opened from a line « Next » of the summary of the thread "${origin.title}" (id ${origin.id}): I approved it, `
      + 'start the work. That thread\'s history is not included: read it with thread_read if a detail is missing.' };
}

async function open(deps: Deps, who: Principal, f: any, reply: Reply) {
  need(str(f.client_id, 64) && id(f.thread) && str(f.what, 2000));
  const origin = await deps.store.getThread(f.thread); need(!!origin && !origin.memoryReview, 'forbidden');
  const space = await memberSpace(deps, who, origin!.space);
  need(space.trusted.includes(who.id), 'forbidden'); // opening a thread makes the agent work: a lead only, as a Lounge card
  need(modOn(space, 'threads'), 'module_off');
  const what: string = f.what;
  // The line as the summary has it now: never a text of the client's own (it would be a post that skips the composer).
  const sum = await deps.store.getSummary(origin!.id);
  need(!!sum && sum.next_steps.some(s => s.what === what), 'stale');
  const opened = await openFrom(deps, who, space, origin!, what, f.client_id, reply);
  if (opened) await dropLead(deps, space, leadId(origin!.id, what), opened, who.id); // the line was a pending lead: opened now
}

/**
 * Opens the line `what` of `origin` as a thread of its agent, for the lead `who` (gates checked by the caller), once:
 * the line's trace on the origin first. Answers the ack with the thread; returns it when this call created it.
 * Shared with « Open » on a pending lead (hub/src/leads.ts).
 */
export async function openFrom(deps: Deps, who: Principal, space: Space, origin: StoredThread, what: string, clientId: string, reply: Reply): Promise<string | null> {
  need(agentsOf(space).includes(origin.owner), 'stale');
  const f = { client_id: clientId };
  // The line's trace first, in a conditional write (mutateThread retries on the version): of two clicks, one reserves
  // the thread id, the other reads it and only answers with it.
  const threadId = deps.newId();
  let won = false;
  const o2 = await mutateThread(deps, origin!.id, { type: 'noop' }, undefined, undefined, x => {
    won = !x.nextOpened?.some(n => n.what === what);
    return won ? { ...x, nextOpened: [...(x.nextOpened ?? []), { what, thread: threadId }].slice(-NEXT_OPENED_MAX) } : x;
  }, false);
  const got = o2.nextOpened!.find(n => n.what === what)!.thread;
  if (!won) { await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: got, msg_id: '' }); return null; }
  const thread = await mutateThread(deps, null, { type: 'human.post', trusted: true },
    { id: threadId, space: space.id, title: what.replace(/\s+/g, ' ').trim().slice(0, 80), owner: origin!.owner, from: origin!.id, opener: who.id },
    undefined, x => ({ ...x, people: [who.id], nextOf: origin!.id }));
  const first: Message = { id: deps.newId(), thread: threadId, author: { kind: 'human', id: who.id }, type: 'text', text: what, at: deps.now() };
  await deps.store.upsertMessage(first);
  const o3 = await mutateThread(deps, origin!.id, { type: 'noop' }, undefined, undefined, x => ({ ...x, spawned: [...(x.spawned ?? []), threadId] }), false);
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(thread) });
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(o3) });
  await broadcast(deps, space.id, { v: 2, type: 'event', event: 'message.created', data: first });
  console.log('next_open', JSON.stringify({ space: space.id, from: origin!.id, thread: threadId, by: who.id }));
  await reply({ v: 2, type: 'ack', client_id: f.client_id, thread: threadId, msg_id: first.id });
  if (await take(deps, space, thread, first.at, who.id)) await deliver(deps, space, thread, nextGo(thread, origin!, who.id, first, deps), []);
  // else the agent is busy elsewhere: started at its turn (kickoff)
  return threadId;
}

/** Late kickoff (the agent was busy at the click): the same go, from the origin as it is now. */
export async function nextKickoff(deps: Deps, space: Space, thread: StoredThread, by: string, first: Message, later: Message[]) {
  const origin = await deps.store.getThread(thread.nextOf!);
  return await deliver(deps, space, thread, nextGo(thread, { id: thread.nextOf!, title: origin?.title ?? '' }, by, first, deps), later);
}

async function human(deps: Deps, who: Principal, f: any, reply: Reply) {
  need(f.type === 'next.open', 'unknown_type');
  return await open(deps, who, f, reply);
}

export const nextsteps: HubModule = { prefix: 'next', human };
