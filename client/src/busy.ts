// Sidebar "working" dot: DOM-free rule, tested in client/test.
import type { PublicThread } from '../../protocol/frames.ts';

/**
 * Conversations of the space with an agent at work, counted apart because each has its own sidebar entry:
 * - threads (Work): a turn running, same source as the "Milan is working" chip (`state === 'run'`);
 * - topics (Lounge): at least one agent in a turn there (`working`, filled by the hub for topics only).
 * Archived ones and the hidden memory review topic are left out (nothing to look at in the lists).
 */
export function busyCounts(threads: Iterable<PublicThread>, space: string): { threads: number; topics: number } {
  const n = { threads: 0, topics: 0 };
  for (const f of threads) {
    if (f.space !== space || f.archived || f.memoryReview) continue;
    if (f.kind === 'topic') { if (f.working?.length) n.topics++; }
    else if (f.state === 'run') n.threads++;
  }
  return n;
}

/**
 * Agents working in a conversation, for the « X is working… » line and chip: the hub lists them (`working`, several
 * agents can be called in a topic, or by a mention in a thread); else, in a thread, its owner while the turn runs.
 */
export const workingAgents = (f: Pick<PublicThread, 'state' | 'owner' | 'working'>): string[] =>
  f.state !== 'run' ? [] : f.working?.length ? f.working : [f.owner];

/** Tool phrase of one agent in one conversation (`thread.status`; `rev` only compares within one agent's instance). */
export const statusKey = (thread: string, agent: string) => `${thread}\n${agent}`;

/** « 9 min · 39 steps » next to the working phrase: whole minutes since the turn start (none under one minute or
 * when the plugin's clock is ahead), model calls so far (none at 0). From the status frame, nothing stored. */
export function progressOf(s: { since?: number; steps?: number } | undefined, now: number): { min: number | null; steps: number | null } {
  const min = s?.since ? Math.floor((now - s.since) / 60_000) : 0;
  return { min: min >= 1 ? min : null, steps: s?.steps && s.steps > 0 ? s.steps : null };
}

/** After a thread update: drops the phrases of agents no longer working in it (all of them once the turn is over). */
export function pruneStatus(status: Map<string, unknown>, f: Pick<PublicThread, 'id' | 'state' | 'owner' | 'working'>): void {
  const keep = new Set(workingAgents(f).map(a => statusKey(f.id, a)));
  for (const k of [...status.keys()]) if (k.startsWith(`${f.id}\n`) && !keep.has(k)) status.delete(k);
}
