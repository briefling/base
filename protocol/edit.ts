// Editing one's last message (↑ in an empty composer). Pure rules shared by the hub (the gate) and the client (which
// only offers what the hub would accept). Blair's design: free edit, with no time limit, even after the agent's
// answer (the edit is delivered again as a new turn, the old answer stays); while the agent works, it is stopped first
// (`turn.stop`) and the edit waits for its turn end; another human's message closes the edit for good.
import type { Message } from './frames.ts';

/** Why `msg` can't be edited by `me` now: refusal codes of `message.edit`, also used by the client. */
export type EditBlock = 'unknown' | 'not_author' | 'deleted' | 'replied' | 'busy';

const isStopLine = (m: Message) => m.author.kind === 'system' && !!m.stop;
/** Conversation in time order (hub time `at`: agent message ids carry the agent's clock, not the hub's). */
const timeOrder = (msgs: Iterable<Message>) => [...msgs].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * null when `me` may edit `msgId` now. `turnActive`: the agent is in a turn in this conversation ('busy': stop it
 * first). An agent's answer after it does not close it (correct the message the agent misread, it answers
 * again). Any human message after it (someone else, or the author's own newer one) closes it.
 */
export function editBlock(msgs: Iterable<Message>, msgId: string, me: string, turnActive: boolean): EditBlock | null {
  const all = timeOrder(msgs), i = all.findIndex(m => m.id === msgId);
  if (i < 0) return 'unknown';
  const m = all[i];
  if (!deletable(m, me)) return 'not_author';
  if (m.deleted) return 'deleted';
  const after = all.slice(i + 1);
  if (after.some(x => x.author.kind === 'human' && !x.deleted)) return 'replied'; // a deleted reply no longer counts
  return turnActive ? 'busy' : null;
}

/**
 * Agent messages the edit erases: the partial answer of the last stopped turn after `msgId`, only when that turn
 * called no tool (`stop.acted` false). With a tool called, what was done stays done, so its answer stays too; the
 * answers of earlier stopped turns (before the previous stop line) are never touched, nor anything once the agent
 * answered after that stop (an answer stays).
 */
export function erasedByEdit(msgs: Iterable<Message>, msgId: string): string[] {
  const all = timeOrder(msgs), i = all.findIndex(m => m.id === msgId);
  if (i < 0) return [];
  const after = all.slice(i + 1), stops = after.flatMap((x, k) => isStopLine(x) ? [k] : []);
  const last = stops.at(-1);
  if (last === undefined || after[last].stop!.acted || after.slice(last + 1).some(x => x.author.kind === 'agent')) return [];
  const from = stops.length > 1 ? stops.at(-2)! + 1 : 0;
  return after.slice(from, last).filter(x => x.author.kind === 'agent').map(x => x.id);
}

/** The last message `me` could edit with ↑ in this conversation: their own latest text message not deleted, if any. */
export function lastOwn(msgs: Iterable<Message>, me: string): Message | null {
  return timeOrder(msgs).findLast(m => deletable(m, me) && !m.deleted) ?? null;
}

/** `me` wrote `m` (a human text message, not a card answer): they may delete it, any time (`message.delete`). */
export const deletable = (m: Message, me: string) => m.author.kind === 'human' && m.author.id === me && m.type === 'text';
