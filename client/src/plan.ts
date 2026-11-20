// "Launch this plan?" card (Message.plan), DOM-free rules (tested by node): what each step shows and which buttons the
// card offers. The hub checks every action again; these rules only decide what the client displays.
import type { Plan, PlanLink } from '../../protocol/frames.ts';

/** State of a step on a briefling-driven plan: finished, being worked on, still to come, or never run (plan ended). */
export type PlanStepState = 'done' | 'active' | 'next' | 'off';
/** Buttons of the card, in display order. start = Launch (open) or Retry (failed), dismiss = Not now. */
export type PlanButton = 'start' | 'stop' | 'dismiss';

type PlanView = Pick<Plan, 'status' | 'steps' | 'repo' | 'current'>;

/** Board driver: the GitHub Lambda creates issues (each step then shows its `repo#number` link, no state). */
export const isBoardPlan = (p: Pick<Plan, 'repo'>): boolean => !!p.repo;

/**
 * State of step `i` (briefling driver only; null for a board plan or an index out of range). Steps before `current`
 * are finished; while running, `current` is in progress; once stopped it still goes on (the hub opens no next one),
 * the later ones are never run; done = all finished; a failure leaves the steps from `current` on not run.
 */
export function planStepState(p: PlanView, i: number): PlanStepState | null {
  if (isBoardPlan(p) || i < 0 || i >= p.steps.length) return null;
  const cur = p.current ?? 0;
  switch (p.status) {
    case 'done': return 'done';
    case 'running': return i < cur ? 'done' : i === cur ? 'active' : 'next';
    case 'stopped': return i < cur ? 'done' : i === cur ? 'active' : 'off';
    case 'failed': return p.current === undefined ? 'off' : i < cur ? 'done' : 'off';
    case 'open': case 'pending': return 'next';
    default: return 'off';
  }
}

/** Some step already has its GitHub issue: the card can no longer be dismissed (only retried). */
export const planHasIssues = (p: Pick<Plan, 'steps'>): boolean => p.steps.some(s => !!s.number);

/**
 * Buttons for a viewer: none unless trusted. open -> Launch + Not now; running (briefling driver) -> Stop;
 * failed -> Retry, plus Not now while no step has an issue; pending, done, stopped, dismissed -> none.
 */
export function planButtons(p: PlanView, trusted: boolean, threads = true): PlanButton[] {
  if (!trusted) return [];
  // « threads » module off: a plan card left open from before can only be closed (Launch opens threads, refused).
  if (!threads) return planButtons(p, trusted).filter(b => b !== 'start');
  switch (p.status) {
    case 'open': return ['start', 'dismiss'];
    case 'running': return isBoardPlan(p) ? [] : ['stop'];
    // A failed briefling plan is over (its threads exist): stop and propose again. A board one is retried.
    case 'failed': return !isBoardPlan(p) ? [] : planHasIssues(p) ? ['start'] : ['start', 'dismiss'];
    default: return [];
  }
}

/** « Step i of N »: 1-based index of the step in progress, clamped to the plan. */
export function planProgress(p: PlanView): { i: number; n: number } {
  const n = p.steps.length;
  return { i: Math.min(Math.max((p.current ?? 0) + 1, 1), Math.max(n, 1)), n };
}

/**
 * Threads of the steps of the plan a step thread belongs to (`link`), indexed by step: the thread id, or null when that
 * step is not opened yet (or not known to this client). Built from the threads the client has, no extra request.
 */
export function planStepThreads(link: PlanLink, threads: Iterable<{ id: string; plan?: PlanLink }>): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: Math.max(link.of, 0) }, () => null);
  for (const t of threads) {
    const p = t.plan;
    if (p && p.card === link.card && p.parent === link.parent && Number.isInteger(p.step) && p.step >= 0 && p.step < out.length) out[p.step] = t.id;
  }
  return out;
}
