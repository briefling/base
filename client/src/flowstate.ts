// Board flow block and the task thread's header chip (docs/design-flow.md § 4.6): what each flow agent is doing, what
// it spent against its caps. DOM-free (tested). Times of a state are the plugin's seconds.
import type { FlowAgentState } from '../../protocol/frames.ts';
import { translate, type Lang } from './i18n.ts';

export type FlowStatus = 'quota' | 'paused' | 'working' | 'waiting' | 'idle';

/**
 * A pause wins (a running turn still finishes, the card shows its task); working = a turn of its task runs now;
 * waiting = it holds a task between two turns; idle = no task.
 */
export function flowStatus(s: FlowAgentState): FlowStatus {
  if (s.paused) return s.paused.by === 'quota' ? 'quota' : 'paused';
  if (!s.current) return 'idle';
  return s.current.running ? 'working' : 'waiting';
}

export type CapLevel = 'ok' | 'warn' | 'over';
/** Spend against a cap: share of the bar (0-1) and level (warn from 80 %, over from 100 %); no cap = null. */
export function capGauge(spent: number, cap: number | null): { share: number; level: CapLevel } | null {
  if (cap === null || !(cap > 0)) return null;
  const r = spent / cap;
  return { share: Math.min(1, Math.max(0, r)), level: r >= 1 ? 'over' : r >= 0.8 ? 'warn' : 'ok' };
}

/** Task + discussion: what the caps count. */
export const spent = (s: FlowAgentState, w: 'day' | 'month') => s.usage.task[w] + s.usage.discussion[w];

/**
 * The chip of a task thread's header: the agent whose current task is in `thread` (one task per agent and space, the
 * hub gives the hand on that thread to one of them). last = its last sign of life (ms), else the task's start.
 */
export function chipOf(states: Iterable<FlowAgentState>, thread: string): { agent: string; status: FlowStatus; last: number } | null {
  for (const s of states) {
    if (s.current?.thread !== thread) continue;
    return { agent: s.agent, status: flowStatus(s), last: (s.current.alive ?? s.current.since) * 1000 };
  }
  return null;
}

/** Length of a task: "<1 min", "12 min", "1 h 05", "2 d". */
export function durationLabel(seconds: number, l: Lang): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return `<${translate(l, 'ago_min', { n: 1 })}`;
  if (m < 60) return translate(l, 'ago_min', { n: m });
  if (m < 24 * 60) return `${translate(l, 'ago_h', { n: Math.floor(m / 60) })} ${String(m % 60).padStart(2, '0')}`;
  return translate(l, 'ago_d', { n: Math.floor(m / 1440) });
}
