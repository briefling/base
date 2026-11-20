// Metrics view of a space: turns the hub's `SpaceMetrics` into ranked rows (names, bar lengths). DOM-free (tested).
import type { MetricsBucket, MetricsCount, MetricsDay, MetricsPeriod, SpaceMetrics } from '../../protocol/frames.ts';
import type { SignalType } from '../../protocol/radar.ts';

/** Thread states in the order of the lists (work first, then shelved, then archived). */
export const BUCKETS: readonly MetricsBucket[] = ['you', 'run', 'wait', 'calm', 'idea', 'done', 'archived'];
export const DEFAULT_PERIOD: MetricsPeriod = '30d';
export const metricsKey = (space: string, period: MetricsPeriod) => `${space}|${period}`;

/** `share`: bar length, 0-100, relative to the largest row (the first one: rows come ranked). */
export interface Row { id: string; label: string; n: number; share: number; kind?: 'human' | 'agent' }

const withShares = (rs: Omit<Row, 'share'>[]): Row[] => {
  const max = Math.max(1, ...rs.map(r => r.n));
  return rs.map(r => ({ ...r, share: Math.round(100 * r.n / max) }));
};

/**
 * Ranked counts with their display name; past `limit`, the rest is summed into one last row (`others(k)`, id '').
 * `nameOf('')` names the unknown initiator.
 */
export function ranked(counts: (MetricsCount & { kind?: 'human' | 'agent' })[], nameOf: (id: string, kind?: 'human' | 'agent') => string, others: (k: number) => string, limit = 8): Row[] {
  const top = counts.slice(0, counts.length > limit ? limit - 1 : limit).map(c => ({ id: c.id, label: nameOf(c.id, c.kind), n: c.n, ...(c.kind ? { kind: c.kind } : {}) }));
  const rest = counts.slice(top.length);
  if (rest.length) top.push({ id: '', label: others(rest.length), n: rest.reduce((s, c) => s + c.n, 0) });
  return withShares(top);
}

/** Non-empty states in BUCKETS order. */
export function stateRows(m: SpaceMetrics, labelOf: (b: MetricsBucket) => string): Row[] {
  return withShares(BUCKETS.filter(b => (m.threads[b] ?? 0) > 0).map(b => ({ id: b, label: labelOf(b), n: m.threads[b]! })));
}

/** A ranked list says something only with two entries or more (« agent in charge: Milan » alone is noise). */
export const worthShowing = (rows: Row[]) => rows.length > 1;

/** Share of the threads created in the period that are Closed, rounded; null without any thread. */
export function closedShare(m: SpaceMetrics): number | null {
  const all = BUCKETS.reduce((s, b) => s + (m.threads[b] ?? 0), 0);
  return all ? Math.round(100 * (m.threads.done ?? 0) / all) : null;
}

/** Bars of the activity chart: heights 0-100 relative to the busiest day (people + agents stacked); a date label on
 *  every `step`-th day only, counted from the last one (today always labelled), so about `labels` labels at most. */
export interface DayBar extends MetricsDay { human100: number; agent100: number; label: boolean }
export function dayBars(days: MetricsDay[], labels = 8): DayBar[] {
  const max = Math.max(1, ...days.map(d => d.human + d.agent)), step = Math.max(1, Math.ceil(days.length / labels));
  return days.map((d, i) => ({ ...d, human100: 100 * d.human / max, agent100: 100 * d.agent / max, label: (days.length - 1 - i) % step === 0 }));
}

/** « 20/10 » (fr) / « 10/20 » (en) for a `YYYY-MM-DD` day, without any time zone shift. */
export function dayLabel(day: string, lang: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

/** Figures of the cards at the top of the view. */
export function totals(m: SpaceMetrics) {
  const sum = (xs: { n: number }[]) => xs.reduce((s, x) => s + x.n, 0);
  return {
    threads: BUCKETS.reduce((s, b) => s + (m.threads[b] ?? 0), 0),
    topics: m.topics.open + m.topics.archived,
    messages: sum(m.messages),
    human: sum(m.messages.filter(x => x.kind === 'human')),
    agent: sum(m.messages.filter(x => x.kind === 'agent')),
  };
}

/** Radar block: per type, the signals of the period with the share opened (as a thread or a topic) and dismissed (rounded %). */
export interface RadarRow { kind: SignalType; n: number; share: number; opened: number; dismissed: number }
export function radarRows(m: SpaceMetrics): RadarRow[] {
  const ks = m.radar?.kinds ?? [], max = Math.max(1, ...ks.map(k => k.n));
  return [...ks].sort((a, b) => b.n - a.n).map(k => ({ kind: k.kind, n: k.n, share: Math.round(100 * k.n / max),
    opened: Math.round(100 * (k.thread + (k.topic ?? 0)) / k.n), dismissed: Math.round(100 * k.dismissed / k.n) }));
}
/** Mean LLM spend of a Radar pass in the period (passes whose turn ended); null without any. */
export const radarPerPass = (m: SpaceMetrics): number | null => m.radar?.passes ? m.radar.usd / m.radar.passes : null;
