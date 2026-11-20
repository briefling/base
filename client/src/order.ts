// Display order of a conversation, DOM-free (tested by node).
//
// The hub stores a card (`propose`, `issue`, `about`, `plan`, a « To decide » `ask` with items) when the agent calls its tool, in the middle of its turn, while
// the agent's text that announces it arrives at the end of the turn. Sorted by `at` alone, the card shows above the
// message that introduces it. Display only: stored data and `at` stay as they are.
import type { Message } from '../../protocol/frames.ts';

/** Cards posted by the hub on an agent's tool call during its turn. */
const TURN_CARDS = new Set<Message['type']>(['propose', 'issue', 'about', 'plan', 'elevation']);

/** A turn card, or the « To decide » card (`ask.choices`: an `ask` with items). An approval `ask` (no items) stays put. */
const isTurnCard = (m: Message) => TURN_CARDS.has(m.type) || (m.type === 'ask' && !!m.ask?.items?.length);

/**
 * Messages in chronological order (`at`, then id: ids are time-sortable), except that each turn card is moved after
 * the agent messages that directly follow it, i.e. to the end of the agent's turn. Any human or system message stops
 * the move: the card never jumps over someone else's message. Several cards of one turn keep their own order.
 */
export function convOrder(msgs: Iterable<Message>): Message[] {
  const sorted = [...msgs].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: Message[] = [];
  let held: Message[] = [];
  for (const m of sorted) {
    if (isTurnCard(m)) held.push(m);
    else if (m.author.kind === 'agent' || !held.length) out.push(m);
    else { out.push(...held, m); held = []; }
  }
  return out.concat(held);
}
