// Whose turn a Your turn thread is, for the member looking at it. The hub computes one state per thread (`you`) and
// sends the push only to the humans concerned (`people`, protocol/notify.ts); the client applies the same rule to the
// badge, the lists and the counters. Pure (no DOM), tested in client/test/turnof.test.ts.
import type { Person, PublicThread } from '../../protocol/frames.ts';

type Turn = Pick<PublicThread, 'state' | 'people'>;

/**
 * The thread is Your turn for someone else: the humans it waits on (still members, in order of arrival), else null.
 * Null = not Your turn, or Your turn for `me`: I am one of them, or none is known (older thread, or only ex-members:
 * every member, as for the push). `directory` = the space's people as the client has them; not loaded yet = `people`
 * taken as is.
 */
export function turnOf(f: Turn, me: string | null, directory: readonly Person[] | undefined): string[] | null {
  if (f.state !== 'you' || !f.people?.length) return null;
  const members = directory?.filter(p => p.kind === 'human' && !p.gone).map(p => p.id);
  // Same rule as `yourTurnTo` (protocol/notify.ts), whose « none known = every member » fallback means « mine » here.
  const to = [...new Set(f.people)].filter(p => !members || members.includes(p));
  return !to.length || (me && to.includes(me)) ? null : to;
}

/** Your turn for `me`: counted in Now, the sidebar badges and the tab title. `muted`: `me` muted the space, so only a
 *  thread naming `me` in `people` counts (the « none known = every member » fallback no longer applies). */
export function myTurn(f: Turn, me: string | null, directory: readonly Person[] | undefined, muted = false): boolean {
  if (f.state !== 'you' || turnOf(f, me, directory)) return false;
  return !muted || (!!me && !!f.people?.includes(me) && (!directory || directory.some(p => p.id === me && p.kind === 'human' && !p.gone)));
}

/**
 * Colour of the thread's Summary card: `done` (green) when the agent declared its work done (the « ✓ done » test),
 * `you` (orange) when it is Your turn for `me`, `run` (blue) otherwise (working, waiting, someone else's turn, quiet).
 */
export function summaryTone(f: Turn & Pick<PublicThread, 'outcome'>, me: string | null, directory: readonly Person[] | undefined): 'done' | 'you' | 'run' {
  if (f.state !== 'run' && f.outcome?.kind === 'done') return 'done';
  return myTurn(f, me, directory) ? 'you' : 'run';
}

/**
 * Whether the Summary card shows its « Waiting on … » line: only while the thread's outcome is still `waiting`.
 * The summary row is the agent's and nobody rewrites it when the wait ends (Done button, a trusted human's message),
 * so its `waiting_on` would otherwise outlive the wait until the agent's next turn.
 */
export const summaryWaits = (f: Pick<PublicThread, 'outcome'>, waitingOn: string | null | undefined): waitingOn is string =>
  !!waitingOn && f.outcome?.kind === 'waiting';

/** First name shown in the badge: first word of the directory name, else the short id. */
const firstName = (id: string, directory: readonly Person[] | undefined) =>
  directory?.find(p => p.id === id)?.name.trim().split(/\s+/)[0] || id.slice(0, 6);

/** Badge text parts: the first person's first name, how many others (« +1 »), and every full name for the tooltip. */
export function turnLabel(ids: readonly string[], directory: readonly Person[] | undefined): { name: string; more: number; all: string[] } {
  return { name: firstName(ids[0], directory), more: ids.length - 1,
    all: ids.map(id => directory?.find(p => p.id === id)?.name || id.slice(0, 6)) };
}
