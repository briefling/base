// Live thumbnail of the agent's browser, hub side (protocol/browser.ts). Nothing is written for a capture: a human
// connection marks the conversation it has on screen on its own subscription (`browser.watch`, one update per change),
// and the agent's `browser.frame` goes only to those connections, members of the space. The agent is told how many
// got it (`browser.watchers`): 0 makes its plugin stop capturing for a while. A module without on/off (modules.ts).
import { browserFrameOk } from '../../protocol/browser.ts';
import { type HubFrame, type Principal } from '../../protocol/frames.ts';
import { id, inTurn, memberSpace, need, sendOne, type Deps, type StoredThread } from './router.ts';
import type { HubModule } from './modules.ts';

type Reply = (f: HubFrame) => Promise<boolean>;

async function human(deps: Deps, who: Principal, f: any, _reply: Reply, connId: string) {
  need(f.type === 'browser.watch', 'unknown_type');
  need(typeof f.space === 'string' && (f.thread === null || id(f.thread)));
  await memberSpace(deps, who, f.space);
  if (f.thread !== null) { const t = await deps.store.getThread(f.thread); need(!!t && t.space === f.space, 'forbidden'); }
  await deps.store.setSubWatch(f.space, connId, f.thread);
}

/** A capture (or the end of the navigation) from the agent working in `cur`: to the members watching it, never stored. */
async function frame(deps: Deps, cur: StoredThread, as: string, f: any, reply: Reply) {
  need(browserFrameOk(f));
  need(inTurn(cur, as) || f.end === true, 'no_turn');
  const space = await deps.store.getSpace(cur.space);
  const data = { thread: cur.id, agent: as, at: f.at, ...(f.end ? { end: true as const } : { jpeg: f.jpeg, ...(f.w ? { w: f.w } : {}), ...(f.h ? { h: f.h } : {}) }) };
  let n = 0;
  for (const sub of await deps.store.listSubs(cur.space)) {
    if (sub.kind !== 'human' || sub.watch !== cur.id || !space?.members.includes(sub.principal)) continue;
    const ok = await sendOne(deps, sub.connId, { v: 2, type: 'event', event: 'browser.frame', data });
    if (ok === false) await deps.store.deleteSub(cur.space, sub.connId); else if (ok) n++;
  }
  await reply({ v: 2, type: 'browser.watchers', thread: cur.id, n });
}

export const browser: HubModule = { prefix: 'browser', human, agent: { 'browser.frame': frame } };
