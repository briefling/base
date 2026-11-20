// Metrics of a space, computed on demand (frame `metrics.get`): pure, so the router tests drive it through the fake store.
import { METRICS_MAX_DAYS, METRICS_TOP, type MetricsBucket, type MetricsCount, type MetricsDay, type MetricsPeriod, type MetricsSplit, type PublicThread, type SpaceMetrics, type Usage, type HiddenOrigin, type HiddenUsage, type RadarMetrics, costSplit } from '../../protocol/frames.ts';
import { RADAR_TYPES, type RadarPassCost, type Signal } from '../../protocol/radar.ts';
import { addSplit, addUsage } from './usage.ts';
import { METRICS_MAX_THREADS, METRICS_PERIODS } from '../../protocol/frames.ts';
import { RADAR_LIST_MAX } from '../../protocol/radar.ts';
import { byActivity, id, memberSpace, METRICS_READS, need, pool, Refused, type Deps, type Space } from './router.ts';
import type { HubModule } from './modules.ts';

/** What the hub reads per thread for the metrics: the opener (never public) and its messages, oldest first. */
export interface ThreadActivity {
  opener?: string;
  // card: thread opened from this propose card; proposed: a propose card still open (title, proposing agent)
  messages: { id: string; kind: 'human' | 'agent' | 'system'; author: string; at: number; card?: string; proposed?: { title: string; by?: string } }[];
}

export const PERIOD_MS: Record<MetricsPeriod, number | null> = { '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: null };

const ranked = (m: Map<string, number>): MetricsCount[] =>
  [...m].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** `YYYY-MM-DD` of a timestamp in time zone `tz` (Intl; UTC when `tz` is missing or unknown to the runtime). */
export function dayKey(tz?: string): (at: number) => string {
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  return at => f.format(at);
}
/** Calendar day after `day` (pure date arithmetic, no time zone involved). */
const nextDay = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };

/** Every day from the first one with a message to `today` (empty days at 0), the latest METRICS_MAX_DAYS. */
function daySeries(counts: Map<string, MetricsDay>, today: string): MetricsDay[] {
  const first = [...counts.keys()].sort()[0];
  if (!first) return [];
  const out: MetricsDay[] = [];
  for (let d = first; d <= today; d = nextDay(d)) out.push(counts.get(d) ?? { day: d, human: 0, agent: 0 });
  return out.slice(-METRICS_MAX_DAYS);
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

/** Bucket shown in the view: archived first, then Closed as the client counts it (done, or Quiet with a `done` outcome). */
export function bucketOf(f: Pick<PublicThread, 'state' | 'archived' | 'outcome'>): MetricsBucket {
  if (f.archived) return 'archived';
  return f.state === 'calm' && f.outcome?.kind === 'done' ? 'done' : f.state;
}

/**
 * `rows`: every thread of the space active since `since` (so every thread created or written in the period) with its
 * activity. Creation time = its first message (ids are not parsed: the first message is written with the thread).
 * `trusted`: trusted humans of the space, for the initiator of threads opened before `opener` was recorded.
 */
export function spaceMetrics(rows: { thread: PublicThread; activity: ThreadActivity }[], o: { period: MetricsPeriod; since: number | null; now: number; trusted: string[]; tz?: string; partial?: boolean; hidden?: HiddenUsage[] }): SpaceMetrics {
  const since = o.since ?? -Infinity;
  const byId = new Map(rows.map(r => [r.thread.id, r]));
  const threads: SpaceMetrics['threads'] = {}, topics = { open: 0, archived: 0 };
  const openers = new Map<string, number>(), authors = new Map<string, number>(), owners = new Map<string, number>();
  const msgs = new Map<string, { kind: 'human' | 'agent'; n: number }>();
  const byAgent = new Map<string, { n: number; usage: Usage; split: MetricsSplit }>();
  let split: MetricsSplit = {};
  const day = dayKey(o.tz), days = new Map<string, MetricsDay>(), costly: { id: string; title: string; usd: number }[] = [];
  let total: Usage | undefined, costed = 0, items = 0;
  for (const { thread: f, activity: a } of rows) {
    for (const m of a.messages) if (m.kind !== 'system' && m.at >= since) {
      const c = msgs.get(m.author) ?? { kind: m.kind, n: 0 }; c.n++; msgs.set(m.author, c);
      const k = day(m.at), d = days.get(k) ?? { day: k, human: 0, agent: 0 }; d[m.kind]++; days.set(k, d);
    }
    const created = a.messages[0]?.at ?? f.updatedAt;
    if (created < since) continue;
    items++;
    if (f.usage) {
      costed++; total = addUsage(total, f.usage);
      const s = costSplit(f), g = byAgent.get(f.owner);
      split = addSplit(split, s) ?? {};
      byAgent.set(f.owner, { n: (g?.n ?? 0) + 1, usage: addUsage(g?.usage, f.usage), split: addSplit(g?.split, s) ?? {} });
    }
    if (f.kind === 'topic') { if (f.archived) topics.archived++; else topics.open++; bump(authors, f.author ?? ''); continue; }
    if (f.usage) costly.push({ id: f.id, title: (f.title ?? '').slice(0, 120), usd: f.usage.usd });
    const b = bucketOf(f); threads[b] = (threads[b] ?? 0) + 1;
    bump(owners, f.owner);
    bump(openers, initiator(f, a, byId, o.trusted));
  }
  // Hidden turns (Radar runs, memory review, titling): in the total and the agent's spend, and listed per origin.
  const hidden = new Map<HiddenOrigin, Usage>();
  for (const x of o.hidden ?? []) {
    total = addUsage(total, x.usage);
    hidden.set(x.origin, addUsage(hidden.get(x.origin), x.usage));
    const s = costSplit({ usage: x.usage }), g = byAgent.get(x.agent);
    split = addSplit(split, s) ?? {};
    byAgent.set(x.agent, { n: g?.n ?? 0, usage: addUsage(g?.usage, x.usage), split: addSplit(g?.split, s) ?? {} });
  }
  return {
    period: o.period, since: o.since, at: o.now, threads, topics,
    openers: ranked(openers), topicAuthors: ranked(authors), owners: ranked(owners),
    messages: [...msgs].map(([id, c]) => ({ id, kind: c.kind, n: c.n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1)),
    cost: { total: total ?? null, byAgent: [...byAgent].map(([id, g]) => ({ id, n: g.n, usage: g.usage, split: g.split })).sort((a, b) => b.usage.usd - a.usage.usd || (a.id < b.id ? -1 : 1)), costed, items,
      median: median(costly.map(c => c.usd)), top: costly.sort((a, b) => b.usd - a.usd || (a.id < b.id ? -1 : 1)).slice(0, METRICS_TOP), split,
      ...(hidden.size ? { hidden: [...hidden].map(([origin, usage]) => ({ origin, usage })).sort((a, b) => b.usage.usd - a.usage.usd || (a.origin < b.origin ? -1 : 1)) } : {}) },
    days: daySeries(days, day(o.now)),
    ...(o.partial ? { partial: true } : {}),
  };
}

/** Who started a thread: its opener; before `opener` was recorded, the trusted human whose request led to the card
 *  (last one before the card in the parent, like the hub's turn author), or the first human of a thread posted
 *  directly; '' when the parent is not loaded or nothing matches. */
export function initiator(f: PublicThread, a: ThreadActivity, byId: Map<string, { activity: ThreadActivity }>, trusted: string[]): string {
  if (a.opener) return a.opener;
  if (!f.from) return a.messages.find(m => m.kind === 'human')?.author ?? '';
  const parent = byId.get(f.from)?.activity.messages ?? [];
  const i = parent.findIndex(m => m.card === f.id);
  if (i < 0) return '';
  return parent.slice(0, i).filter(m => m.kind === 'human' && trusted.includes(m.author)).at(-1)?.author ?? '';
}

/**
 * Radar block of the Metrics view (step 5): signals first seen since `since`, per type, with how many the team opened
 * as a thread, as a topic (discussed first) or dismissed; the passes started since then, their spend and signal writes. Undefined when both are empty.
 */
export function radarMetrics(signals: Signal[], passes: RadarPassCost[], since: number | null): RadarMetrics | undefined {
  const from = since ?? -Infinity, mine = signals.filter(s => s.at >= from), ran = passes.filter(p => p.at >= from);
  if (!mine.length && !ran.length) return undefined;
  const kinds = RADAR_TYPES.map(kind => {
    const of = mine.filter(s => s.kind === kind);
    return { kind, n: of.length, thread: of.filter(s => s.state === 'thread').length, topic: of.filter(s => s.state === 'topic').length, dismissed: of.filter(s => s.state === 'dismissed').length };
  }).filter(k => k.n > 0);
  return { kinds, passes: ran.length, usd: ran.reduce((s, p) => s + p.usd, 0), signals: ran.reduce((s, p) => s + p.signals, 0) };
}

/** Metrics view of a space (humans: `metrics.get`; agents: `space_metrics`). */
export async function metricsOf(deps: Deps, space: Space, period: MetricsPeriod, tz?: string): Promise<SpaceMetrics> {
  const now = deps.now(), span = PERIOD_MS[period], since = span === null ? null : now - span;
  // Bounded work per call: past METRICS_MAX_THREADS, the least recently active threads are left out (said in the view).
  const all = (await deps.store.listThreads(space.id, since ?? 0)).sort(byActivity);
  const threads = all.slice(0, METRICS_MAX_THREADS);
  const rows = await pool(threads, METRICS_READS, async thread => ({ thread, activity: await deps.store.threadActivity(thread.id) }));
  // Hidden turns: whole UTC days from the period's start (a day's row is not split by hour).
  const hidden = await deps.store.listHiddenUsage(space.id, since === null ? '' : new Date(since).toISOString().slice(0, 10));
  const out = spaceMetrics(rows, { period, since, now, trusted: space.trusted, tz, partial: all.length > threads.length, hidden });
  const radar = radarMetrics(await deps.store.listSignals(space.id, RADAR_LIST_MAX), (await deps.store.getRadarConfig(space.id))?.passes ?? [], since);
  return radar ? { ...out, radar } : out;
}

/** Module plug (hub/src/modules.ts): the Metrics view (`metrics.get`, any member). */
export const metrics: HubModule = {
  module: 'metrics',
  prefix: 'metrics',
  async human(deps, who, f, reply) {
    if (f.type === 'metrics.get') {
      need(id(f.space) && METRICS_PERIODS.includes(f.period) && (f.tz === undefined || (typeof f.tz === 'string' && f.tz.length <= 64)));
      const space = await memberSpace(deps, who, f.space);
      await reply({ v: 2, type: 'metrics', space: space.id, metrics: await metricsOf(deps, space, f.period, f.tz) });
      return;
    }
    throw new Refused('unknown_type');
  },
};
