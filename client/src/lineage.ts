// Flow view of a space: lays out the hub's `SpaceLineage` (topics, threads, open cards) as plain geometry, DOM-free
// (tested): one lane per person, time left to right, curves from a conversation to what it opened. (A radial « Map »
// tab was shipped then removed, Blair: « retire la view map c'est nul ».)
import type { LineageNode, LineagePeriod, MetricsBucket, SpaceLineage } from '../../protocol/frames.ts';

export const DEFAULT_LINEAGE_PERIOD: LineagePeriod = '7d';
export const lineageKey = (space: string, period: LineagePeriod) => `${space}|${period}`;
const DAY = 86_400_000;
/** Number of line colours (CSS classes `lc0`…): roots cycle through them in order of start. */
export const LINE_COLORS = 6;

/** States hidden by « Hide quiet ». */
const QUIET: readonly MetricsBucket[] = ['calm', 'archived'];

export interface Prepared {
  bare: number;                       // topics folded by hideBare
  nodes: LineageNode[];               // visible ones, by start
  byId: Map<string, LineageNode>;
  kids: Map<string, LineageNode[]>;   // visible children by start
  rootOf: Map<string, string>;        // node -> its root (a topic, or a thread with no known parent)
  roots: LineageNode[];               // by start
  color: Map<string, number>;         // root -> colour index
  t0: number; t1: number;
}

/**
 * Visible nodes: with `hideQuiet`, Quiet and archived topics/threads go, unless something visible descends from them
 * (the lineage stays whole). A node whose parent is not in the answer becomes a root.
 */
export function prepare(l: SpaceLineage, hideQuiet: boolean, hideBare = false): Prepared {
  const all = new Map(l.nodes.map(n => [n.id, n]));
  const allKids = new Map<string, LineageNode[]>();
  for (const n of l.nodes) if (n.parent && all.has(n.parent)) allKids.set(n.parent, [...(allKids.get(n.parent) ?? []), n]);
  const shown = new Map<string, boolean>();
  const visible = (n: LineageNode): boolean => {
    const c = shown.get(n.id); if (c !== undefined) return c;
    shown.set(n.id, false); // cycle guard
    const own = !hideQuiet || n.kind === 'card' || !QUIET.includes(n.state ?? 'calm');
    // A Lounge topic that opened nothing (no thread, no card) is folded with hideBare: most topics are just a question.
    const kidsShown = (allKids.get(n.id) ?? []).map(visible).some(Boolean);
    const v = kidsShown || own && !(hideBare && n.kind === 'topic' && !(allKids.get(n.id) ?? []).length);
    shown.set(n.id, v); return v;
  };
  const byStart = (a: LineageNode, b: LineageNode) => a.start - b.start || (a.id < b.id ? -1 : 1);
  const nodes = l.nodes.filter(visible).sort(byStart);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const kids = new Map<string, LineageNode[]>();
  for (const n of nodes) if (n.parent && byId.has(n.parent)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const rootOf = new Map<string, string>();
  const findRoot = (n: LineageNode, seen = new Set<string>()): string => {
    const known = rootOf.get(n.id); if (known) return known;
    const p = n.parent ? byId.get(n.parent) : undefined;
    const r = !p || seen.has(p.id) ? n.id : findRoot(p, seen.add(n.id));
    rootOf.set(n.id, r); return r;
  };
  nodes.forEach(n => findRoot(n));
  const roots = nodes.filter(n => rootOf.get(n.id) === n.id);
  const color = new Map(roots.map((r, i) => [r.id, i % LINE_COLORS]));
  const t1 = l.at, t0 = l.since ?? Math.min(t1 - DAY, ...nodes.map(n => n.start));
  const bare = hideBare ? l.nodes.filter(n => n.kind === 'topic' && !allKids.has(n.id) && !byId.has(n.id)).length : 0;
  return { bare, nodes, byId, kids, rootOf, roots, color, t0, t1 };
}

/** Rough width of a label in px (no DOM to measure): enough to keep labels apart. */
export const textWidth = (s: string, px = 12.5) => Math.ceil(s.length * px * 0.6);

/** Titles are long (a topic's title is its first message): cut on screen, whole in the tooltip. */
export const LABEL_MAX = 34;
export const short = (s: string) => s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1).trimEnd() + '…' : s;

// ---------------------------------------------------------------- time scale (not linear)
/** Width of a day with nothing in it (hours of 28/24 px); an hour grows up to HOUR_MAX with its activity. */
export const DAY_MIN = 28;
const HOUR_MIN = DAY_MIN / 24;
const HOUR_MAX: Record<LineagePeriod, number> = { '3d': 180, '7d': 150, '30d': 100 };
const TALK_WEIGHT = 0.35; // an hour of discussion counts for less room than an hour of agent work
const START_WEIGHT = 0.6; // each topic or thread started in that hour: a little more than half an hour of work
const H = 3_600_000;
export interface TimeScale { x: (t: number) => number; days: { at: number; x: number; w: number }[]; hours: { at: number; x: number; w: number }[] }

/**
 * One slot per hour (local days, cut at midnight), its width growing with the activity in it (square root, so a huge
 * hour does not crush the others): agent work and discussion of the segments in it, plus the topics and threads
 * started then. A dense day spreads hour by hour, a quiet hour keeps HOUR_MIN: the order and the gaps stay readable.
 */
export function timeScale(p: Prepared, period: LineagePeriod, x0: number): TimeScale {
  const dayAt: number[] = [], slots: number[] = [], dayOfSlot: number[] = [];
  const d = new Date(p.t0); d.setHours(0, 0, 0, 0);
  for (; d.getTime() <= p.t1; ) {
    const s0 = d.getTime(); d.setDate(d.getDate() + 1); const e = d.getTime();
    dayAt.push(s0);
    for (let t = s0; t < e; t += H) { slots.push(t); dayOfSlot.push(dayAt.length - 1); }
  }
  const end = d.getTime(), next = (i: number) => slots[i + 1] ?? end;
  const slotOf = (t: number) => { let lo = 0, hi = slots.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (slots[m] <= t) lo = m; else hi = m - 1; } return lo; };
  const act = slots.map(() => 0);
  for (const n of p.nodes) {
    if (n.start >= slots[0] && n.start < end) act[slotOf(n.start)] += START_WEIGHT;
    for (const [a, b, work] of n.segs ?? []) {
      if (b < slots[0]) continue;
      for (let i = slotOf(Math.max(a, slots[0])); i < slots.length && slots[i] < b; i++)
        act[i] += (Math.min(b, next(i)) - Math.max(a, slots[i])) / H * (work ? 1 : TALK_WEIGHT);
    }
  }
  const top = Math.max(0, ...act);
  const w = act.map(a => top > 0 ? HOUR_MIN + (HOUR_MAX[period] - HOUR_MIN) * Math.sqrt(a / top) : HOUR_MIN * 2);
  const left: number[] = [];
  let acc = x0;
  for (const v of w) { left.push(acc); acc += v; }
  const x = (t: number) => {
    if (t <= slots[0]) return x0;
    const i = slotOf(t);
    return left[i] + Math.min(1, (t - slots[i]) / (next(i) - slots[i])) * w[i];
  };
  const days = dayAt.map((at, k) => {
    const first = dayOfSlot.indexOf(k), last = dayOfSlot.lastIndexOf(k);
    return { at, x: left[first], w: Math.round((left[last] + w[last] - left[first]) * 10) / 10 };
  });
  return { x, days, hours: slots.map((at, i) => ({ at, x: left[i], w: w[i] })) };
}

// ---------------------------------------------------------------- Threads (one lane per person)
export interface LaneNode { n: LineageNode; x: number; y: number; x2: number; segs: [x1: number, x2: number, work: 0 | 1][]; line: number }
export interface Lane { who: string; agent: boolean; y: number; h: number }
export interface LaneEdge { d: string; cross: boolean; line: number; from: string; to: string }
export interface Lanes { width: number; height: number; x0: number; nowX: number; lanes: Lane[]; nodes: LaneNode[]; edges: LaneEdge[]; days: { x: number; at: number; w: number }[]; hours: { x: number; at: number; w: number }[] }

/** X0: where the lanes start (people column + 8), X0_NARROW: same on a phone, where the column shows the avatar only. */
export const LANE = { X0: 196, X0_NARROW: 52, HEAD: 30, ROW: 30, PAD: 8, TOP: 34, GAP: 16 };

/**
 * One lane per initiator (humans in order of first appearance, then agents, i.e. the proposers of open cards, then the
 * unknown ''), each node on the first free row of its lane. Edges go from the parent (topic circle, or the point of the
 * parent's bar at the child's start) to the child; `cross` = the child's initiator is not the parent's (thread taken
 * up by someone else).
 */
export function lanes(p: Prepared, period: LineagePeriod, allAgents = false, x0 = LANE.X0): Lanes {
  const sc = timeScale(p, period, x0), x = sc.x;
  const agents = new Set(p.nodes.filter(n => allAgents || n.kind === 'card').map(n => n.who));
  if (!allAgents) for (const n of p.nodes) if (n.kind !== 'card') agents.delete(n.who); // a person who also opens threads is not an agent lane
  agents.delete('');
  const order: string[] = [];
  for (const n of p.nodes) if (!order.includes(n.who)) order.push(n.who);
  order.sort((a, b) => rank(a) - rank(b));
  function rank(w: string) { return w === '' ? 2 : agents.has(w) ? 1 : 0; }
  const rows = new Map<string, number[]>(order.map(w => [w, []]));
  const slot = new Map<string, number>();
  let width = x(p.t1) + 60;
  for (const n of p.nodes) {
    const sx = x(n.start), used = rows.get(n.who)!;
    const title = short(n.title), label = n.kind === 'topic' ? 22 : n.kind === 'card' ? textWidth(title, 11) + 14 : textWidth(title, 11) + 6;
    const ex = Math.max(sx + label, x(n.kind === 'thread' ? lastOf(n) : n.start)) + LANE.GAP;
    let s = 0; while (used[s] !== undefined && used[s] > sx) s++;
    used[s] = ex; slot.set(n.id, s); width = Math.max(width, ex + 20);
  }
  const ls: Lane[] = [];
  let y = LANE.TOP;
  for (const w of order) { const h = LANE.HEAD + Math.max(1, rows.get(w)!.length) * LANE.ROW + LANE.PAD; ls.push({ who: w, agent: agents.has(w), y, h }); y += h; }
  const laneY = new Map(ls.map(l => [l.who, l.y]));
  const nodes: LaneNode[] = p.nodes.map(n => ({
    n, x: x(n.start), y: laneY.get(n.who)! + LANE.HEAD + slot.get(n.id)! * LANE.ROW + 14, x2: x(n.kind === 'thread' ? lastOf(n) : n.start),
    segs: (n.segs ?? []).filter(s => s[1] >= p.t0).map(s => [x(s[0]), Math.max(x(s[1]), x(s[0]) + 3), s[2]]),
    line: p.color.get(p.rootOf.get(n.id)!) ?? 0,
  }));
  const at = new Map(nodes.map(v => [v.n.id, v]));
  const edges: LaneEdge[] = [];
  for (const k of nodes) {
    const pa = k.n.parent ? at.get(k.n.parent) : undefined;
    if (!pa) continue;
    const bx = pa.n.kind === 'topic' ? pa.x : Math.min(Math.max(pa.x + 10, k.x - 60), Math.max(pa.x + 10, pa.x2));
    const c = Math.max(40, (k.x - bx) * 0.55);
    edges.push({ d: `M${r1(bx)},${r1(pa.y)} C${r1(bx + c)},${r1(pa.y)} ${r1(k.x - c)},${r1(k.y)} ${r1(k.x - 9)},${r1(k.y)}`,
      cross: pa.n.who !== '' && k.n.who !== '' && pa.n.who !== k.n.who, line: k.line, from: pa.n.id, to: k.n.id });
  }
  const days = sc.days, hours = sc.hours;
  return { width: Math.ceil(width), height: y + 10, x0, nowX: x(p.t1), lanes: ls, nodes, edges, days, hours };
}
/** End of a thread's bar: its last message or its last segment, whichever is later. */
const lastOf = (n: LineageNode) => Math.max(n.last, n.segs?.at(-1)?.[1] ?? 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- zoom (Threads)
export const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** Wheel / pinch: proportional to the scroll amount (a trackpad sends many small events), 100 px of wheel ≈ +17 %. */
export const zoomWheel = (z: number, deltaY: number) => Math.round(clampZoom(z * Math.exp(-deltaY * 0.0016)) * 1000) / 1000;
/** Next zoom level (−/+ buttons): `dir` > 0 zooms in, < 0 out, by 20 % a step (several steps for a big wheel turn), clamped. */
export function zoomStep(z: number, dir: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * Math.pow(1.2, dir))) * 100) / 100;
}
/** Scroll that keeps the point under the cursor (`at`, px from the box's edge) in place when zooming from z1 to z2. */
export const anchorScroll = (scroll: number, at: number, z1: number, z2: number) => Math.max(0, (scroll + at) * z2 / z1 - at);

/** What the hover highlights: the node, its ancestors up to its root and its whole subtree (threads it opened, and so on). */
export function related(p: Prepared, id: string): Set<string> {
  const out = new Set<string>();
  for (let n = p.byId.get(id); n && !out.has(n.id); n = n.parent ? p.byId.get(n.parent) : undefined) out.add(n.id);
  const down = (x: string) => { for (const k of p.kids.get(x) ?? []) if (!out.has(k.id)) { out.add(k.id); down(k.id); } };
  down(id);
  return out;
}

// ---------------------------------------------------------------- per person
export interface PersonStats { topics: number; threads: number; done: number; active: number; cards: number; usd: number; costed: boolean }
/**
 * What each initiator started in the period (context ancestors excluded): Lounge topics, threads, threads delivered
 * (Closed: done, or Quiet with a done outcome, as the hub buckets them), threads still active (Your turn, In progress,
 * Waiting), open cards (agents), and the cost of the topics and threads they started (cumulated `usd`).
 */
export function personStats(l: SpaceLineage): Map<string, PersonStats> {
  const out = new Map<string, PersonStats>();
  for (const n of l.nodes) {
    if (n.context) continue;
    const s = out.get(n.who) ?? { topics: 0, threads: 0, done: 0, active: 0, cards: 0, usd: 0, costed: false };
    if (n.kind === 'topic') s.topics++;
    else if (n.kind === 'card') s.cards++;
    else { s.threads++; if (n.state === 'done') s.done++; else if (n.state === 'you' || n.state === 'run' || n.state === 'wait') s.active++; }
    if (n.usd !== undefined) { s.usd += n.usd; s.costed = true; }
    out.set(n.who, s);
  }
  return out;
}
/** The best shipper(s): the most threads delivered in the period, at least one; ties all get the crown. Unknown '' never,
 *  nor a lone lane (a crown with nobody to beat says nothing). */
export function bestShippers(stats: Map<string, PersonStats>): Set<string> {
  if ([...stats.keys()].filter(w => w !== '').length < 2) return new Set();
  const top = Math.max(0, ...[...stats].filter(([w]) => w !== '').map(([, s]) => s.done));
  return new Set(top > 0 ? [...stats].filter(([w, s]) => w !== '' && s.done === top).map(([w]) => w) : []);
}

// ---------------------------------------------------------------- per agent
/** A node of the « by agent » view: lane = the agent in charge, `initiator` = who started it (shown on hover). */
export type ViewNode = LineageNode & { initiator?: string };
/**
 * Same lineage, one lane per agent: a topic or thread goes to its agent in charge (`owner`), an open card to the agent
 * that proposed it; '' when unknown. Curves, stats and the crown then read per agent (a cross curve = a thread handed
 * to another agent than its parent's).
 */
export function byAgent(l: SpaceLineage): SpaceLineage {
  return { ...l, nodes: l.nodes.map((n): ViewNode => ({ ...n, initiator: n.who, who: n.kind === 'card' ? n.who : n.owner ?? '' })) };
}
