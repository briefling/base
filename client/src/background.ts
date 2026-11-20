// Background work of a thread (protocol/frames.ts `Background`): what the agent still runs once its turn is over
// (sub-agents, processes it gets notified of). Pure helpers for the list, the header and the info panel.
import type { BgTask, PublicThread } from '../../protocol/frames.ts';

type Bg = Pick<PublicThread, 'state' | 'background'>;
/** Number of tasks running in the background (0 = none). */
export const bgCount = (f: Pick<PublicThread, 'background'>) => f.background?.tasks.length ?? 0;
/** Quiet with background work: shown « In progress (background) » (under In progress) instead of Quiet. */
export const bgWork = (f: Bg) => f.state === 'calm' && bgCount(f) > 0;
/** Oldest first: the one running for the longest time comes first. */
export const bgTasks = (f: Pick<PublicThread, 'background'>): BgTask[] => (f.background?.tasks ?? []).slice().sort((a, b) => a.since - b.since);
/** « Milan is working in the background » under the last message: no turn running but tasks still declared. The oldest
 * task's goal, how many others, whole minutes since it started (null under one minute or when the agent's clock is
 * ahead). A lost lease empties the list on the hub, so the line goes away and the `waiting` outcome takes over. */
export function bgLine(f: Bg, now: number): { goal: string; more: number; min: number | null } | null {
  const ts = f.state === 'run' ? [] : bgTasks(f);
  if (!ts.length) return null;
  const min = Math.floor((now - ts[0].since) / 60_000);
  return { goal: ts[0].goal, more: ts.length - 1, min: min >= 1 ? min : null };
}
/** Tooltip of the badge: one goal per line, oldest first. */
export const bgTip = (f: Pick<PublicThread, 'background'>) => bgTasks(f).map(t => t.goal).join('\n');
