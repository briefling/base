// Thread state: computed from facts, never chosen (design: thread life cycle).
// Display priority: Your turn › Running › Waiting › Calm. Idea and Closed are human choices.
// Your turn = a question waits for an answer, the agent waits for an action from the human (`waiting` outcome, even once seen),
// or the agent finished a turn that nobody (trusted) has seen yet.
// Calm = finished AND seen, with no expected action.
import type { ThreadFacts, ThreadState, Outcome } from '../../protocol/frames.ts';

export const initialFacts = (): ThreadFacts => ({ turnActive: false, pendingAsk: null, unseenReply: null, outcome: null, manual: null });

/**
 * Labels of a board issue that hand it to a human: the flow's agents stop touching the item (BLOCKING in
 * hermes-plugin/briefling/flow/model.py) until someone answers on GitHub, so the thread is Your turn while one is set.
 * GitHub label names are case-insensitive.
 */
export const HUMAN_LABELS = ['needs:human', 'spec:question'];
export const humanLabel = (labels: readonly string[] | undefined) => !!labels?.some(l => HUMAN_LABELS.includes(l.toLowerCase()));

/** `labels`: the issue's labels of a board-driven thread (`board.labels`), none elsewhere. */
export function computeState(f: ThreadFacts, labels?: readonly string[]): ThreadState {
  if (f.manual) return f.manual;
  if (f.pendingAsk) return 'you';
  if (f.turnActive) return 'run'; // a human answered in the thread and the agent works on it: label still set meanwhile
  if (humanLabel(labels)) return 'you';
  if (f.parked) return 'wait'; // waits for a shared resource: nothing expected from the human
  if (f.outcome?.kind === 'waiting') return 'you'; // "seen" is not enough: it must have been done
  if (f.unseenReply) return 'you';
  // 'wait' will come from summaries (next step owed by a third party), slice 4.
  return 'calm';
}

export type FactEvent =
  | { type: 'turn.started' }
  // unseen: false for a Lounge topic and for a guest's turn; busy: another agent still works in the thread
  | { type: 'turn.ended'; at: number; unseen: boolean; busy?: boolean }
  | { type: 'seen'; at: number }
  | { type: 'ask'; ask_id: string; approval?: boolean } // approval: the card is a command approval (isApprovalAsk)
  | { type: 'outcome'; outcome: Outcome }               // announced by the agent (guards in the router)
  | { type: 'handled'; at: number }                     // "Done" from a trusted human
  | { type: 'human.post'; trusted: boolean } // only a trusted human "sees" the reply for the team
  | { type: 'human.answer'; ask_id: string; trusted?: boolean }
  // The agent rewrote the ask card as a plain message (Hermes turns an expired approval into « Approval timed out »): nothing to answer any more.
  | { type: 'ask.closed'; ask_id: string }
  | { type: 'action'; kind: 'idea' | 'done' | 'reopen' }
  | { type: 'parked'; resource: string | null };        // queued for a resource (router), or out of the queue (null)

/** pendingApproval only lives with its card: every event that closes the card (answer, post, expiry) drops it too. */
export function applyFact(f: ThreadFacts, e: FactEvent): ThreadFacts {
  const g = step(f, e);
  if (g.pendingAsk || g.pendingApproval === undefined) return g;
  const { pendingApproval: _, ...rest } = g;
  return rest;
}

function step(f: ThreadFacts, e: FactEvent): ThreadFacts {
  switch (e.type) {
    case 'turn.started': return { ...f, turnActive: true };
    // A parked thread's turn end is not a reply to see: the agent only said what it waits for.
    case 'turn.ended': return { ...f, turnActive: !!e.busy, unseenReply: e.unseen && !f.parked ? e.at : f.unseenReply ?? null };
    // Seen only if that very turn is the one that was shown (guard like for ask_id). Does not clear a wait.
    case 'seen': return f.unseenReply === e.at ? { ...f, unseenReply: null } : f;
    case 'ask': { const { pendingApproval: _, ...rest } = f; return { ...rest, pendingAsk: e.ask_id, ...(e.approval ? { pendingApproval: true } : {}) }; }
    case 'outcome': return { ...f, outcome: e.outcome };
    // "Done" on the wait shown (not a more recent one): the thread becomes finished, and it was necessarily seen.
    case 'handled': return f.outcome?.kind === 'waiting' && f.outcome.at === e.at ? { ...f, outcome: { kind: 'done', at: e.at }, unseenReply: null, parked: null } : f;
    case 'human.answer': return f.pendingAsk === e.ask_id ? { ...f, pendingAsk: null, unseenReply: null, outcome: e.trusted ? null : f.outcome ?? null } : f;
    // A trusted human who writes in a thread de facto answers the pending question (so they saw the reply), and reopens a put-away thread.
    // An untrusted member's message reaches no agent: the question stays open.
    // If trusted, they open a new exchange: the outcome of the previous turn (wait included) no longer holds.
    // Trusted: new exchange, the thread leaves a resource queue too (the router drops it; the agent re-acquires if needed).
    case 'ask.closed': return f.pendingAsk === e.ask_id ? { ...f, pendingAsk: null } : f;
    case 'human.post': return { ...f, pendingAsk: e.trusted ? null : f.pendingAsk ?? null, unseenReply: e.trusted ? null : f.unseenReply ?? null, outcome: e.trusted ? null : f.outcome ?? null, manual: null,
      parked: e.trusted ? null : f.parked ?? null };
    case 'action': return { ...f, manual: e.kind === 'reopen' ? null : e.kind, parked: e.kind === 'reopen' ? f.parked ?? null : null };
    case 'parked': return { ...f, parked: e.resource };
  }
}
