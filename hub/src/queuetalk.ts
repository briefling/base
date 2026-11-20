// Talk while queued: a thread waiting in its agent's queue (strict mode, the hand held elsewhere) still gets a turn for
// each message of a trusted human, with the Lounge's rights (read, test, throwaway spike; no commit, push, deploy,
// cloud change). The thread keeps its place and stays Waiting; when the place comes, the hub relaunches the agent on
// its own with that discussion as context (`handOver`). The hard gate is the hub's: while the thread is queued it
// refuses `acquire_resource`, `turn_outcome` and `pushed_commits` (code `queued`); the rest is the plugin's prompt
// rule, as in the Lounge (an agent ignoring it could still commit: accepted risk).
import type { Message, QueuedTalk } from '../../protocol/frames.ts';
import { type Deps, type Space, type StoredLock, type StoredThread, boardDriven, deliverPending, mutateLock, normLock } from './router.ts';

/** Per queued thread that talked: `last` = `at` of the last message delivered as a talk turn (never delivered twice);
 *  `fresh` = opened from a card and never started then (its kickoff still owed at the handover). Cleared when the
 *  thread leaves the queue. */
export type Talk = { last: number; fresh: boolean };

/** True when the thread waits in its agent's queue (a talk turn, if a turn runs): never for a topic. */
export const inQueue = (l: Pick<StoredLock, 'queue'> | null | undefined, thread: Pick<StoredThread, 'id' | 'kind'>) =>
  thread.kind !== 'topic' && !!l?.queue.includes(thread.id);

/** Reads the hand: is `thread` queued right now? (Board-driven spaces take no hand: their queue is always empty.) */
export async function queuedNow(deps: Deps, thread: StoredThread): Promise<boolean> {
  if (thread.kind === 'topic') return false;
  return inQueue(normLock(await deps.store.getLock(thread.space, thread.owner)), thread);
}

/**
 * A trusted human wrote in a queued thread (`take` returned false): record the talk (first time only) and deliver a
 * talk turn. Not delivered when the thread left the queue meanwhile (the handover delivers that message itself).
 * A thread never started (opened from a card, kickoff owed) gets its whole history, the brief included.
 */
export async function talkWhileQueued(deps: Deps, space: Space, thread: StoredThread, msg: Message, last: Message[]) {
  if (boardDriven(space)) return;
  const was = !!thread.from && thread.lastTurnAt === 0;
  let lock: StoredLock | null = null, fresh = was;
  await mutateLock(deps, space.id, thread.owner, l => {
    lock = inQueue(l, thread) ? l : null;
    const t = l.talk?.[thread.id];
    if (!lock || (t && t.last >= msg.at)) { lock = null; return null; } // left the queue, or already delivered
    fresh = t ? t.fresh : was;
    return { ...l, talk: { ...l.talk, [thread.id]: { last: msg.at, fresh } } };
  });
  const l = lock as StoredLock | null;
  if (!l) return;
  const title = l.holders[0] ? (await deps.store.getThread(l.holders[0]))?.title : undefined;
  const queued: QueuedTalk = { position: l.queue.indexOf(thread.id) + 1, ...(title ? { holder: title } : {}) };
  await deliverPending(deps, space, thread, msg, last, thread.owner, false, queued, fresh);
}

/**
 * The handover of a thread that talked while queued (`next.talk`). `msg`: the last trusted message not answered yet.
 * Already delivered as a talk turn (its answer may still be running) or none: the hub relaunches the agent with
 * RELAUNCH_TEXT (not stored; its session holds the discussion). A newer one: delivered as usual. Either way the
 * context says the place came (`relaunched`), so the Lounge rights of the talk turns end.
 */
export function relaunchOf(talk: Talk, msg: Message | undefined): 'relaunch' | 'deliver' {
  return !msg || msg.at <= talk.last ? 'relaunch' : 'deliver';
}

/** The message that relaunches a thread whose place came after talk turns, with nothing new to answer (not stored). */
export const RELAUNCH_TEXT = 'briefling: your place in the queue has come, this thread now holds the hand. Earlier in this '
  + 'conversation you talked while it waited (Lounge rights then). Now do the work agreed there, with the usual rights '
  + 'of a thread, and end with turn_outcome as usual.';
