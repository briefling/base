// Later and Closed: the two shelves of a space, reached from the filter heading its list (In progress · Later · Closed).
// Pure (no DOM) so node can test it. Client side only: the hub states stay `idea` (Later) and `done` (Closed).
import type { PublicThread } from '../../protocol/frames.ts';

type Shelved = Pick<PublicThread, 'space' | 'kind' | 'state' | 'updatedAt' | 'archived' | 'outcome'>;

/** Finished: closed by a human (state done) or a Quiet thread whose agent announced "done" at the end of its turn.
 *  A trusted message clears that outcome (hub `human.post`), so the thread comes back to the list on its own. */
export const finished = (f: Shelved) => f.state === 'done' || (f.state === 'calm' && f.outcome?.kind === 'done');

/** State badge reads « ✓ done » instead of Quiet: the agent ended its last turn with « done » and the thread is Quiet
 *  as shown (`shown`: a queued/parked Quiet thread shows Waiting, that one keeps its badge). */
export const agentDone = (shown: PublicThread['state'], f: Pick<Shelved, 'outcome'>) => shown === 'calm' && f.outcome?.kind === 'done';

/** Where a thread of a space shows: its list (null), Later (state idea) or Closed (finished, or archived). */
export function shelfOf(f: Shelved): 'later' | 'closed' | null {
  if (f.archived) return 'closed';
  if (f.kind === 'topic') return null; // a live topic lives in the Lounge, whatever its state
  return f.state === 'idea' ? 'later' : finished(f) ? 'closed' : null;
}

/** Later: set-aside threads of the space, last activity first. */
export function laterOf<T extends Shelved>(all: Iterable<T>, space: string): T[] {
  return [...all].filter(f => f.space === space && shelfOf(f) === 'later').sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Sort time in Closed: archive date for an archived item, last activity otherwise. */
export const closedAt = (f: Shelved) => f.archived?.at ?? f.updatedAt;

/** Closed: one list, finished and archived mixed (told apart by a badge), most recent first. */
export function closedOf<T extends Shelved>(all: Iterable<T>, space: string): T[] {
  return [...all].filter(f => f.space === space && shelfOf(f) === 'closed').sort((a, b) => closedAt(b) - closedAt(a));
}

/** Counters of the filter heading the space list, Later and Closed: threads in the space list (live, not a topic, on no
 *  shelf) and on Later. None for Closed: its older pages load on demand, so counting the loaded ones would be wrong. */
export function shelfCounts(all: Iterable<Shelved>, space: string): { work: number; later: number } {
  let work = 0, later = 0;
  for (const f of all) {
    if (f.space !== space) continue;
    const k = shelfOf(f);
    if (k === 'later') later++;
    else if (!k && f.kind !== 'topic') work++;
  }
  return { work, later };
}

type ShelfView = { kind: string; id?: string };

/** The open conversation was on the Later/Closed shelf shown and the user's own message took it off (the hub reopens
 *  it on a trusted post): the view follows it home (the Lounge for a topic, the space list for a thread, or the other
 *  shelf), same conversation open. Null = stay: not the open conversation, not the user's message (`posted` false:
 *  someone else reopening it does not move you), or still on the shelf. */
export function followView(view: ShelfView, sel: string | null, posted: string | null, f: Shelved & { id: string }):
  { kind: 'lounge' | 'space' | 'later' | 'closed'; id: string } | null {
  if ((view.kind !== 'later' && view.kind !== 'closed') || view.id !== f.space || sel !== f.id || posted !== f.id) return null;
  const shelf = shelfOf(f);
  if (shelf === view.kind) return null;
  return { kind: shelf ?? (f.kind === 'topic' ? 'lounge' : 'space'), id: f.space };
}
