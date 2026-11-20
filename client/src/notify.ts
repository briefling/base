// Desktop alerts (open tab only, no Web Push): pure rules, tested in client/test.
import type { Message, PublicThread } from '../../protocol/frames.ts';

/** Thread counted and signalled "Your turn": a thread (not a Lounge topic), not archived. */
export const isYours = (f: PublicThread) => f.kind !== 'topic' && !f.archived && f.state === 'you';

/** Message a Your turn alert jumps to: the agent's last answer (text or question), like the hub's push; null if none loaded. */
export function lastAnswer(msgs: Iterable<Message>): string | null {
  let last: Message | null = null;
  for (const m of msgs) if (m.author.kind === 'agent' && (m.type === 'text' || m.type === 'ask') && (!last || m.at >= last.at)) last = m;
  return last?.id ?? null;
}

/**
 * The thread just became Your turn. Only a transition from a known state: a thread discovered at load
 * (no previous state) that is already Your turn triggers nothing, and neither does an older frame (same version).
 */
export const becameYours = (before: PublicThread | undefined, after: PublicThread) =>
  !!before && after.version > before.version && !isYours(before) && isYours(after);

/**
 * What to do when a thread becomes Your turn. Tab in the background (hidden or unfocused): system notification + pop.
 * In front of the app: pop only, and nothing if it is the open thread (it is already in view).
 */
export const alertKind = (away: boolean, isOpen: boolean): 'both' | 'pop' | 'none' => away ? 'both' : isOpen ? 'none' : 'pop';

/** Tab title: "(2) briefling" when threads are Your turn. */
export const tabTitle = (n: number) => n > 0 ? `(${n}) briefling` : 'briefling';
