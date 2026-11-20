// Personal mute of a space: the member who mutes a space stops being notified of its messages (Web Push,
// open-tab alert), except their Your turn (never filtered) and the messages that @mention them. Set by `mute.set`
// (any member, for oneself), stored SPACE#<space> / MUTE#<sub> (aws.ts), sent back only to that person's connections
// (`mute.updated`) and in their own space list (`SpaceInfo.muted`). The agents' mentions that ring whatever the mute
// (`agentMentions`) live here too: both decide who a message rings for. A module without on/off, plugged in through
// hub/src/modules.ts.
import { type HubFrame, type Message, type Mute, type Principal } from '../../protocol/frames.ts';
import { agentMentionTo, unmuted } from '../../protocol/notify.ts';
import { mentionedIds } from '../../client/src/recent.ts';
import { broadcast, humansOf, memberSpace, mutateThread, need, publicThread, sendOne, type Deps, type Space, type StoredThread } from './router.ts';
import type { HubModule } from './modules.ts';

type Reply = (f: HubFrame) => Promise<boolean>;

/** `to` minus the members who muted `space`, unless `text` @mentions them. No read when nobody is to be notified. */
export async function withoutMuted(deps: Pick<Deps, 'store'>, space: Space, to: string[], text: string): Promise<string[]> {
  if (!to.length) return to;
  const muted = new Set(await deps.store.mutedIn(space.id));
  return muted.size ? unmuted(to, muted, mentionedIds(text, humansOf(space))) : to;
}

/**
 * An agent's new message that @mentions members: they are told (tab alert + Web Push) whatever their mute, once per
 * conversation and agent turn (`mentionAt` = the start of the turn that last rang, written before ringing so two
 * parallel Lambdas never both ring). Returns who it rang for (empty = nothing to do). Never for a notice.
 */
export async function agentMentions(deps: Deps, cur: StoredThread, as: string, msg: Message): Promise<string[]> {
  if (msg.notice || cur.memoryReview || cur.archived || !msg.text.includes('@')) return [];
  const space = await deps.store.getSpace(cur.space);
  if (!space) return [];
  const mentioned = mentionedIds(msg.text, humansOf(space));
  const turnAt = cur.turns?.[as]?.at ?? cur.lastTurnAt;
  if (!agentMentionTo(mentioned, space.members, turnAt, cur.mentionAt).length) return [];
  let to: string[] = [];
  const next = await mutateThread(deps, cur.id, { type: 'noop' }, undefined, undefined, x => {
    to = agentMentionTo(mentioned, space.members, turnAt, x.mentionAt);
    return to.length ? { ...x, mentionAt: turnAt } : x;
  }, false);
  // The write moved the version: the tabs get it, so a lead action sent with the version they hold is not refused stale.
  await broadcast(deps, cur.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  return to;
}

async function human(deps: Deps, who: Principal, f: any, _reply: Reply) {
  need(f.type === 'mute.set', 'unknown_type');
  need(typeof f.space === 'string' && typeof f.on === 'boolean' && Number.isSafeInteger(f.at) && f.at > 0);
  await memberSpace(deps, who, f.space); // for oneself only: any member, never for someone else
  const m: Mute = { space: f.space, on: f.on, at: f.at };
  if (!(await deps.store.putMute(who.id, m))) return; // frame older than the last applied one
  // Only to this person's connections: how they organize themselves is their own business (same as pins).
  for (const sub of await deps.store.listSubs(f.space)) {
    if (sub.kind !== 'human' || sub.principal !== who.id) continue;
    if ((await sendOne(deps, sub.connId, { v: 2, type: 'event', event: 'mute.updated', data: m })) === false) await deps.store.deleteSub(f.space, sub.connId);
  }
}

export const mute: HubModule = { prefix: 'mute', human };
