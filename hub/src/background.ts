// Background work of a thread (protocol/frames.ts `Background`): sub-agents and notified processes the plugin declares
// with `thread.background`, outside any turn too. The thread keeps the list (shown « In progress (background) » when
// Quiet); the deadline lives in a `BGWATCH` record that each beat renews. The 5-min poller (`pollBackground`) turns a
// passed deadline into a `waiting` outcome marked `lost`: Your turn + Web Push, never a silent Quiet thread.
import { BG_GOAL_MAX, BG_ID_MAX, BG_LEASE_MS, BG_MAX_TASKS, MAX_ACTION, type BgTask, type Outcome } from '../../protocol/frames.ts';
import { broadcast, mutateThread, need, publicThread, type Deps, type StoredThread } from './router.ts';
import { logEvent } from './details.ts';

/** Deadline of a thread's background work (`BGWATCH`/<thread>): renewed by each `thread.background` beat. */
export interface StoredBgWatch { thread: string; space: string; deadline: number }

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The declared list, cleaned (one line per goal), or null when malformed. Duplicate ids are refused. */
export function bgTasks(x: unknown): BgTask[] | null {
  if (!Array.isArray(x) || x.length > BG_MAX_TASKS) return null;
  const out: BgTask[] = [], ids = new Set<string>();
  for (const t of x) {
    if (!t || typeof t !== 'object') return null;
    const { id, kind, goal, since } = t as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > BG_ID_MAX || ids.has(id)) return null;
    if (kind !== 'delegate' && kind !== 'process') return null;
    if (typeof goal !== 'string' || !Number.isSafeInteger(since) || (since as number) <= 0) return null;
    const g = oneLine(goal);
    if (!g || g.length > BG_GOAL_MAX) return null;
    ids.add(id);
    out.push({ id, kind, goal: g, since: since as number });
  }
  return out;
}

const sameTasks = (a: readonly BgTask[] | undefined, b: readonly BgTask[]) =>
  (a?.length ?? 0) === b.length && b.every((t, i) => a![i].id === t.id && a![i].goal === t.goal && a![i].kind === t.kind && a![i].since === t.since);
const without = (b: StoredThread): StoredThread => { if (!b.background) return b; const { background: _, ...rest } = b; return rest };

/** `thread.background` from the agent in charge (guests are refused before, GUEST_FRAMES). No reply. */
export async function background(deps: Deps, thread: StoredThread, f: any) {
  const tasks = bgTasks(f.tasks);
  need(!!tasks);
  need(thread.kind !== 'topic', 'not_thread');
  const now = deps.now();
  if (tasks!.length) await deps.store.putBgWatch({ thread: thread.id, space: thread.space, deadline: now + BG_LEASE_MS });
  // A beat with the same list rewrites nothing but the deadline (no thread write, no broadcast).
  if (sameTasks(thread.background?.tasks, tasks!)) return;
  // touch = false: background work is not activity, the thread keeps its place and read state.
  const next = await mutateThread(deps, thread.id, { type: 'noop' }, undefined, undefined,
    b => tasks!.length ? { ...b, background: { tasks: tasks! } } : without(b), false);
  if (!tasks!.length) await deps.store.deleteBgWatch(thread.id, null);
  await broadcast(deps, next.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
}

/** Goals of the lost tasks, as the `waiting` action (cut to MAX_ACTION). */
export function lostAction(tasks: readonly BgTask[]): string {
  const s = tasks.map(t => t.goal).join(' · ');
  return s.length > MAX_ACTION ? s.slice(0, MAX_ACTION - 1).trimEnd() + '…' : s;
}

/**
 * Poller pass (every 5 min): each watch past its deadline is lost. The watch is deleted first, only if its deadline
 * is still the one read (a beat that renewed it meanwhile wins); then the thread loses its list and becomes Your turn
 * (`waiting` + `lost`), unless it was closed, put Later or archived since (list cleared, nothing else).
 */
export async function pollBackground(deps: Deps): Promise<{ open: number; lost: number }> {
  const watches = await deps.store.listBgWatches();
  const now = deps.now();
  let lost = 0;
  for (const w of watches) {
    if (w.deadline > now) continue;
    if (!await deps.store.deleteBgWatch(w.thread, w.deadline)) continue;
    const cur = await deps.store.getThread(w.thread);
    if (!cur?.background?.tasks.length) continue;
    let out: Outcome | null = null;
    const next = await mutateThread(deps, cur.id, b => {
      out = b.background?.tasks.length && !b.archived && !b.facts.manual && b.kind !== 'topic'
        ? { kind: 'waiting', action: lostAction(b.background.tasks), at: now, lost: true } : null;
      return out ? { type: 'outcome', outcome: out } : { type: 'noop' };
    }, undefined, undefined, without);
    if (out) {
      lost++;
      const o: Outcome = out;
      await logEvent(deps, next, { at: now, kind: 'outcome', agent: next.owner, outcome: 'waiting', ...(o.action ? { action: o.action } : {}) });
      console.log('background_lost', next.id, cur.background.tasks.length);
    }
    await broadcast(deps, next.space, { v: 2, type: 'event', event: 'thread.upserted', data: publicThread(next) });
  }
  return { open: watches.length - lost, lost };
}
