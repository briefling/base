// Live state of a flow agent (docs/design-flow.md § 4.6): the plugin's `flow.state` report, checked field by field
// before the hub stores and broadcasts it. Everything the humans see comes from here: unknown keys are dropped, texts
// lose their control characters and are cut, numbers are bounded, a malformed report is refused whole.
import { FLOW_ALERTS_MAX, FLOW_ALERT_MAX, FLOW_REASON_MAX, FLOW_REF_RE, FLOW_TRIGGER_RE, type FlowCost, type FlowStateReport } from '../../protocol/frames.ts';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_USD = 1e6;
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const sec = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 1e10;
const usd = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= MAX_USD;
const text = (x: unknown, max: number) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : null;

function cost(x: unknown): FlowCost | null {
  return obj(x) && usd(x.day) && usd(x.month) ? { day: x.day, month: x.month } : null;
}

/** The report, cleaned; null if any part is malformed (the hub then answers bad_frame). */
export function parseFlowState(x: unknown): FlowStateReport | null {
  if (!obj(x)) return null;
  let paused: FlowStateReport['paused'] = null;
  if (x.paused !== null) {
    const p = x.paused, reason = obj(p) ? text(p.reason, FLOW_REASON_MAX) : null;
    if (!obj(p) || (p.by !== 'human' && p.by !== 'quota') || reason === null || !sec(p.since)) return null;
    paused = { by: p.by, reason, since: p.since };
  }
  let current: FlowStateReport['current'] = null;
  if (x.current !== null) {
    const c = x.current;
    if (!obj(c) || typeof c.ref !== 'string' || !FLOW_REF_RE.test(c.ref) || typeof c.trigger !== 'string' || !FLOW_TRIGGER_RE.test(c.trigger)
      || !(c.thread === null || (typeof c.thread === 'string' && ID_RE.test(c.thread))) || !sec(c.since) || typeof c.running !== 'boolean'
      || !(c.alive === null || sec(c.alive))) return null;
    current = { ref: c.ref, trigger: c.trigger, thread: c.thread as string | null, since: c.since, running: c.running, alive: c.alive as number | null };
  }
  const u = x.usage, task = obj(u) ? cost(u.task) : null, discussion = obj(u) ? cost(u.discussion) : null;
  if (!task || !discussion) return null;
  const c = x.caps;
  if (!obj(c) || !(c.day === null || usd(c.day)) || !(c.month === null || usd(c.month))) return null;
  if (!Array.isArray(x.alerts) || x.alerts.length > 50) return null;
  const alerts: FlowStateReport['alerts'] = [];
  for (const a of x.alerts.slice(-FLOW_ALERTS_MAX)) {
    const ref = obj(a) ? text(a.ref, 120) : null, t = obj(a) ? text(a.text, FLOW_ALERT_MAX) : null;
    if (!obj(a) || !sec(a.at) || ref === null || t === null) return null;
    alerts.push({ at: a.at, ref, text: t });
  }
  return { paused, current, usage: { task, discussion }, caps: { day: c.day as number | null, month: c.month as number | null }, alerts };
}
