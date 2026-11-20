// « Blair is typing… »: a member typing in a composer sends `typing.set` at most every 3 s (client),
// relayed at once as `typing.updated` to the tabs of the space's OTHER members. Never stored, never sent to an agent
// (no wake, no LLM cost), never acknowledged (a lost one only shortens the line). A module without on/off, plugged in
// through hub/src/modules.ts.
import type { HubFrame, Principal } from '../../protocol/frames.ts';
import { canSee, id, memberSpace, need, sendOne, type Deps } from './router.ts';
import type { HubModule } from './modules.ts';

async function human(deps: Deps, who: Principal, f: any) {
  need(f.type === 'typing.set', 'unknown_type');
  need(id(f.thread) && (f.off === undefined || f.off === true));
  const th = await deps.store.getThread(f.thread);
  need(!!th, 'forbidden');
  const space = await memberSpace(deps, who, th!.space); // a non-member learns nothing, not even that the thread exists
  const ev: HubFrame = { v: 2, type: 'event', event: 'typing.updated', data: { space: space.id, thread: th!.id, who: who.id, ...(f.off ? { off: true as const } : {}) } };
  for (const sub of await deps.store.listSubs(space.id)) {
    if (sub.kind !== 'human' || sub.principal === who.id || !canSee(space, sub.principal)) continue;
    if ((await sendOne(deps, sub.connId, ev)) === false) await deps.store.deleteSub(space.id, sub.connId);
  }
}

export const typing: HubModule = { prefix: 'typing', human };
