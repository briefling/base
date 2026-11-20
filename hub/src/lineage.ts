// Flow view of a space, computed on demand (frame `lineage.get`): pure, so the router tests drive it through the fake store.
import { LINEAGE_IDLE_MS, LINEAGE_MAX_SEGMENTS, isGeneralId, type LineageNode, type LineagePeriod, type LineageSeg, type PublicThread, type SpaceLineage } from '../../protocol/frames.ts';
import { bucketOf, initiator, type ThreadActivity } from './metrics.ts';
import { LINEAGE_MAX_THREADS, LINEAGE_PERIODS } from '../../protocol/frames.ts';
import { byActivity, id, memberSpace, METRICS_READS, need, pool, Refused, type Deps, type Space } from './router.ts';
import type { HubModule } from './modules.ts';

export const LINEAGE_PERIOD_MS: Record<LineagePeriod, number | null> = { '3d': 3 * 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/**
 * Work / discussion segments of a thread, deduced from its messages (oldest first, system lines ignored): see
 * `LineageNode.segs`. `runningUntil`: the thread is In progress, its last work is stretched to that time.
 */
export function segments(messages: ThreadActivity['messages'], runningUntil?: number): LineageSeg[] {
  const out: LineageSeg[] = [];
  const push = (a: number, b: number, work: 0 | 1) => {
    const prev = out.at(-1);
    if (prev && prev[2] === work && a <= prev[1]) prev[1] = Math.max(prev[1], b);
    else out.push([a, b, work]);
  };
  let start: number | null = null, lastAgent: number | null = null;
  for (const m of messages) {
    if (m.kind === 'system') continue;
    if (m.kind === 'agent') { start ??= m.at; lastAgent = m.at; continue; }
    // A human message: it closes the agent's answer to the previous one (if any) and starts the next turn.
    if (start !== null && lastAgent !== null) {
      push(start, lastAgent, 1);
      if (m.at - lastAgent <= LINEAGE_IDLE_MS) push(lastAgent, m.at, 0);
      start = null; lastAgent = null;
    }
    start ??= m.at; // several human messages before an answer: the turn starts at the first one
  }
  if (start !== null && (lastAgent !== null || runningUntil !== undefined)) push(start, Math.max(lastAgent ?? start, runningUntil ?? 0), 1);
  return out.slice(-LINEAGE_MAX_SEGMENTS);
}

/**
 * `rows`: the space's threads and topics active since `since` with their activity; `ancestors`: the topics and
 * threads they come from that are not in `rows` (outside the period), shown as `context`. Nodes started before
 * `since` are kept: a thread active in the period belongs to it, whenever it began. General is never a node (one
 * parent for every topic it opened turned the view into a fan of curves): the topics opened from it are roots.
 */
export function spaceLineage(rows: { thread: PublicThread; activity: ThreadActivity }[], ancestors: PublicThread[],
  o: { period: LineagePeriod; since: number | null; now: number; trusted: string[]; partial?: boolean }): SpaceLineage {
  rows = rows.filter(r => !isGeneralId(r.thread.id));
  const byId = new Map(rows.map(r => [r.thread.id, r]));
  const parent = (f: PublicThread) => f.from && !isGeneralId(f.from) ? { parent: f.from } : {};
  const nodes: LineageNode[] = [];
  for (const { thread: f, activity: a } of rows) {
    const msgs = a.messages, start = msgs[0]?.at ?? f.updatedAt, last = msgs.at(-1)?.at ?? f.updatedAt;
    const state = bucketOf(f);
    // Initiator as in the metrics; when the parent is outside the period (its card not read), the first human.
    const firstHuman = msgs.find(m => m.kind === 'human')?.author ?? '';
    const who = f.kind === 'topic' ? f.author ?? firstHuman : initiator(f, a, byId, o.trusted) || firstHuman;
    nodes.push({ id: f.id, kind: f.kind === 'topic' ? 'topic' : 'thread', title: f.title ?? '', ...parent(f), who,
      owner: f.owner, state, ...(f.usage ? { usd: f.usage.usd } : {}), start, last,
      ...(f.kind === 'topic' ? {} : { segs: segments(msgs, state === 'run' ? o.now : undefined) }) });
    for (const m of msgs) if (m.proposed) nodes.push({ id: `card:${m.id}`, kind: 'card', title: m.proposed.title, parent: f.id, who: m.proposed.by ?? m.author, start: m.at, last: m.at });
  }
  for (const f of ancestors) {
    if (byId.has(f.id) || isGeneralId(f.id)) continue;
    nodes.push({ id: f.id, kind: f.kind === 'topic' ? 'topic' : 'thread', title: f.title ?? '', ...parent(f),
      who: f.kind === 'topic' ? f.author ?? '' : '', owner: f.owner, state: bucketOf(f), ...(f.usage ? { usd: f.usage.usd } : {}),
      start: o.since ?? f.updatedAt, last: f.updatedAt, context: true });
  }
  return { period: o.period, since: o.since, at: o.now, nodes, ...(o.partial ? { partial: true } : {}) };
}

/** Ids of parents missing from `have` (one level, General excluded): the router fetches them, then asks again for theirs. */
export function missingParents(threads: PublicThread[], have: Set<string>): string[] {
  return [...new Set(threads.map(f => f.from).filter((p): p is string => !!p && !have.has(p) && !isGeneralId(p)))];
}

/** Flow view of a space (humans: `lineage.get`; agents: `space_metrics`). */
export async function lineageOf(deps: Deps, space: Space, period: LineagePeriod): Promise<SpaceLineage> {
  const now = deps.now(), span = LINEAGE_PERIOD_MS[period], since = span === null ? null : now - span;
  // Same bounded read as metrics.get, fewer threads: past LINEAGE_MAX_THREADS the least recently active are left out.
  // General is not in the view: dropped before its (long) activity is read and before it takes a slot.
  const all = (await deps.store.listThreads(space.id, since ?? 0)).filter(x => !isGeneralId(x.id)).sort(byActivity);
  const threads = all.slice(0, LINEAGE_MAX_THREADS);
  const rows = await pool(threads, METRICS_READS, async thread => ({ thread, activity: await deps.store.threadActivity(thread.id) }));
  // Ancestors outside the period (a topic of last month whose thread is active today): public view only, 5 levels.
  const have = new Set(threads.map(x => x.id)), ancestors: PublicThread[] = [];
  let want = missingParents(threads, have);
  for (let depth = 0; depth < 5 && want.length; depth++) {
    const got = await deps.store.threadsByIds(space.id, want.slice(0, 100));
    for (const x of got) { have.add(x.id); ancestors.push(x); }
    want = missingParents(got, have);
  }
  return spaceLineage(rows, ancestors, { period, since, now, trusted: space.trusted, partial: all.length > threads.length });
}

/** Module plug (hub/src/modules.ts): the Flow view (`lineage.get`, any member). */
export const lineage: HubModule = {
  module: 'lineage',
  prefix: 'lineage',
  async human(deps, who, f, reply) {
    if (f.type === 'lineage.get') {
      need(id(f.space) && LINEAGE_PERIODS.includes(f.period));
      const space = await memberSpace(deps, who, f.space);
      await reply({ v: 2, type: 'lineage', space: space.id, lineage: await lineageOf(deps, space, f.period) });
      return;
    }
    throw new Refused('unknown_type');
  },
};
