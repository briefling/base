// LLM spend per thread: the instance sends the spend of each turn in `turn.ended.usage`, the hub sums it on the thread.
// Display only (never billing): a malformed value is dropped, it never blocks the turn end.
import { COST_STATUSES, activityOf, foldActivity, mergeCostStatus, type Activity, type ActivitySpend, type CostStatus, type Usage } from '../../protocol/frames.ts';

const TOKENS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls'] as const;
const MAX_TOKENS = 1e10; // per turn: far above any real turn, bounds what an instance can write
const MAX_USD = 10_000;

/** A valid `usage` of a turn, or null (missing or malformed). */
export function parseUsage(x: unknown): Usage | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const u = x as Record<string, unknown>;
  if (typeof u.usd !== 'number' || !Number.isFinite(u.usd) || u.usd < 0 || u.usd > MAX_USD) return null;
  if (!COST_STATUSES.includes(u.status as CostStatus)) return null;
  for (const k of TOKENS) if (!Number.isSafeInteger(u[k]) || (u[k] as number) < 0 || (u[k] as number) > MAX_TOKENS) return null;
  const out = { usd: u.usd, status: u.status as CostStatus } as Usage;
  for (const k of TOKENS) out[k] = u[k] as number;
  const activity = parseActivity(u.activity);
  if (activity) out.activity = activity;
  return out;
}

/** The per-activity split of a turn: known categories with a valid {usd, calls} only, a retired one (older plugin)
 *  stored as its successor; null when nothing is left. */
function parseActivity(x: unknown): Usage['activity'] | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Partial<Record<string, ActivitySpend>> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!activityOf(k) || !v || typeof v !== 'object') continue;
    const { usd, calls } = v as Record<string, unknown>;
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > MAX_USD) continue;
    if (!Number.isSafeInteger(calls) || (calls as number) < 0 || (calls as number) > MAX_TOKENS) continue;
    out[k] = { usd, calls: calls as number };
  }
  const folded = foldActivity(out);
  return Object.keys(folded).length ? folded : null;
}

const roundUsd = (x: number) => Math.round(x * 1e6) / 1e6;

/** Sum of two activity splits (either may be missing). */
export function addSplit<K extends string>(a: Partial<Record<K, ActivitySpend>> | undefined, b: Partial<Record<K, ActivitySpend>> | undefined): Partial<Record<K, ActivitySpend>> | undefined {
  if (!a || !b) return a ? { ...a } : b ? { ...b } : undefined;
  const out: Partial<Record<K, ActivitySpend>> = { ...a };
  for (const [k, v] of Object.entries(b) as [K, ActivitySpend][]) {
    const c = out[k];
    out[k] = c ? { usd: roundUsd(c.usd + v.usd), calls: c.calls + v.calls } : { ...v };
  }
  return out;
}

/** Thread total + one turn. `usd` rounded to the micro-dollar so float sums don't drift in the display. */
export function addUsage(total: Usage | undefined, turn: Usage): Usage {
  if (!total) return { ...turn };
  const out = { usd: roundUsd(total.usd + turn.usd), status: mergeCostStatus(total.status, turn.status) } as Usage;
  for (const k of TOKENS) out[k] = total[k] + turn[k];
  const activity = addSplit(total.activity, turn.activity);
  if (activity) out.activity = activity;
  return out;
}
