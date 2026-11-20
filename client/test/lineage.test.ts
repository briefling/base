import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, lanes, personStats, bestShippers, byAgent, timeScale, short, zoomStep, zoomWheel, anchorScroll, related, ZOOM_MIN, ZOOM_MAX, DAY_MIN, LABEL_MAX, LANE } from '../src/lineage.ts';
import type { LineageNode, SpaceLineage } from '../../protocol/frames.ts';

const D = 86_400_000, NOW = 100 * D;
const node = (x: Partial<LineageNode> & { id: string }): LineageNode => ({ kind: 'thread', title: x.id, who: 'blair', state: 'run', start: NOW - 5 * D, last: NOW - 4 * D, ...x });
const L = (nodes: LineageNode[]): SpaceLineage => ({ period: '7d', since: NOW - 10 * D, at: NOW, nodes });

// Blair's topic -> his thread a -> Joachim's thread b (taken up by someone else); a quiet thread q; Mini's open card.
const sample = () => L([
  node({ id: 't', kind: 'topic', title: 'Memory', start: NOW - 9 * D }),
  node({ id: 'a', parent: 't', start: NOW - 8 * D, last: NOW - 6 * D, state: 'calm', usd: 4, segs: [[NOW - 8 * D, NOW - 7 * D, 1], [NOW - 7 * D, NOW - 6 * D, 0]] }),
  node({ id: 'b', parent: 'a', who: 'joachim', start: NOW - 5 * D, state: 'you', usd: 1 }),
  node({ id: 'q', parent: 't', start: NOW - 7 * D, state: 'calm' }),
  node({ id: 'card:m1', kind: 'card', parent: 't', who: 'mini', start: NOW - D, state: undefined }),
  node({ id: 'lone', start: NOW - 3 * D }), // posted directly: its own root
]);

test('prepare: roots, colours, and « hide quiet » keeps a quiet ancestor of something visible', () => {
  const all = prepare(sample(), false);
  assert.deepEqual(all.roots.map(r => r.id), ['t', 'lone']);
  assert.equal(all.rootOf.get('b'), 't');
  assert.deepEqual([all.color.get('t'), all.color.get('lone')], [0, 1]);
  const hid = prepare(sample(), true);
  assert.deepEqual(hid.nodes.map(n => n.id).sort(), ['a', 'b', 'card:m1', 'lone', 't']); // q goes, a stays (b descends from it)
});

test('prepare: a parent missing from the answer makes the node a root; a cycle does not loop', () => {
  const p = prepare(L([node({ id: 'x', parent: 'gone' }), node({ id: 'c1', parent: 'c2' }), node({ id: 'c2', parent: 'c1' })]), false);
  assert.equal(p.rootOf.get('x'), 'x');
  assert.ok(p.rootOf.has('c1') && p.rootOf.has('c2'));
  assert.ok(lanes(p, '30d').nodes.length === 3);
});

test('lanes: one lane per person (agents after humans), cross edge when someone else takes the thread up', () => {
  const g = lanes(prepare(sample(), false), '7d');
  assert.deepEqual(g.lanes.map(l => [l.who, l.agent]), [['blair', false], ['joachim', false], ['mini', true]]);
  const e = Object.fromEntries(g.edges.map(x => [x.to, x]));
  assert.equal(e.b.cross, true);
  assert.equal(e.a.cross, false);
  assert.equal(e['card:m1'].cross, true);
  // nodes of a lane never overlap on the same row
  const blair = g.nodes.filter(v => v.n.who === 'blair');
  for (const v of blair) for (const w of blair) if (v !== w && v.y === w.y) assert.ok(Math.abs(v.x - w.x) > 60, `${v.n.id} vs ${w.n.id}`);
  // time runs left to right at the period's scale, the work segment is longer than 0
  const a = g.nodes.find(v => v.n.id === 'a')!;
  assert.ok(a.x > LANE.X0 && a.x < g.nodes.find(v => v.n.id === 'b')!.x);
  assert.deepEqual(a.segs.map(s => s[2]), [1, 0]);
  assert.ok(g.nowX > a.x2 && g.width > g.nowX);
  // phone: a narrower people column moves the whole time axis left, lanes and rows unchanged
  const s = lanes(prepare(sample(), false), '7d', false, LANE.X0_NARROW), d = LANE.X0 - LANE.X0_NARROW;
  assert.equal(s.x0, LANE.X0_NARROW);
  assert.deepEqual(s.lanes, g.lanes);
  for (const v of s.nodes) { const w = g.nodes.find(k => k.n.id === v.n.id)!; assert.ok(Math.abs(w.x - v.x - d) < 0.01 && v.y === w.y, v.n.id); }
});

test('timeScale: busy days are wide, empty days narrow, time keeps its order', () => {
  const l = L([
    node({ id: 'busy', start: NOW - 8 * D, segs: [[NOW - 8 * D + 3_600_000, NOW - 8 * D + 6 * 3_600_000, 1]] }),
    node({ id: 'calm', start: NOW - 3 * D }),
  ]);
  const sc = timeScale(prepare(l, false), '7d', 100);
  const wOf = (t: number) => sc.days.find(d => d.at <= t && t < d.at + D + 3_600_000 && d === sc.days.filter(e => e.at <= t).at(-1))!.w;
  assert.ok(wOf(NOW - 8 * D + 7_200_000) > 300, 'the busiest day takes most of the room');
  assert.ok(wOf(NOW - 3 * D) > DAY_MIN && wOf(NOW - 3 * D) < wOf(NOW - 8 * D + 7_200_000), 'a day with only a start: a little room');
  assert.ok(Math.abs(wOf(NOW - 5 * D) - DAY_MIN) < 0.5, 'empty day');
  for (let t = NOW - 10 * D; t < NOW; t += 3 * 3_600_000) assert.ok(sc.x(t + 3 * 3_600_000) >= sc.x(t));
  assert.equal(sc.x(NOW - 20 * D), 100);
});

test('short: long titles cut with an ellipsis', () => {
  assert.equal(short('abc'), 'abc');
  const s = short('x'.repeat(200));
  assert.equal(s.length, LABEL_MAX);
  assert.ok(s.endsWith('…'));
});

test('prepare: « hideBare » folds the topics that opened nothing, counted', () => {
  const l = sample(); l.nodes.push(node({ id: 'q2', kind: 'topic', start: NOW - 2 * D }));
  const p = prepare(l, false, true);
  assert.ok(!p.byId.has('q2') && p.byId.has('t'));
  assert.equal(p.bare, 1);
  assert.equal(prepare(l, false, false).bare, 0);
  assert.ok(prepare(l, false, false).byId.has('q2'));
});

test('zoom: steps of 20 %, clamped; the point under the cursor stays in place', () => {
  assert.equal(zoomStep(1, 1), 1.2);
  assert.equal(zoomStep(1, -1), 0.83);
  // wheel: proportional and gentle (a trackpad sends many small deltas, a mouse notch is ~100 px)
  assert.ok(zoomWheel(1, -100) > 1.12 && zoomWheel(1, -100) < 1.22);
  assert.ok(zoomWheel(1, 4) < 1 && zoomWheel(1, 4) > 0.99);
  assert.equal(zoomWheel(ZOOM_MAX, -1000), ZOOM_MAX);
  assert.equal(zoomStep(ZOOM_MAX, 1), ZOOM_MAX);
  assert.equal(zoomStep(ZOOM_MIN, -3), ZOOM_MIN);
  // content point at scroll 100 + cursor 50 = 150 (zoom 1) is at 300 at zoom 2: scroll 250 keeps it under the cursor
  assert.equal(anchorScroll(100, 50, 1, 2), 250);
  assert.equal(anchorScroll(0, 10, 2, 0.5), 0);
});

test('timeScale: inside a dense day, the busy hours get the room', () => {
  const day0 = new Date(NOW - 6 * D); day0.setHours(0, 0, 0, 0);
  const h = (k: number) => day0.getTime() + k * 3_600_000;
  const l = L([0, 1, 2, 3, 4, 5].map(i => node({ id: `n${i}`, start: h(14) + i * 60_000, segs: [[h(14), h(15), 1]] })));
  const sc = timeScale(prepare(l, false), '7d', 0);
  const hw = (k: number) => sc.hours.find(x => x.at === h(k))!.w;
  assert.ok(hw(14) > 100 && hw(10) < 2, `${hw(14)} vs ${hw(10)}`);
  assert.ok(sc.x(h(14) + 30 * 60_000) - sc.x(h(14)) > 50, 'half of the busy hour is wide');
});

test('related: the node, its ancestors and its whole subtree, nothing from the sibling branches', () => {
  const p = prepare(sample(), false);
  assert.deepEqual([...related(p, 'a')].sort(), ['a', 'b', 't']);
  assert.deepEqual([...related(p, 't')].sort(), ['a', 'b', 'card:m1', 'q', 't']);
  assert.deepEqual([...related(p, 'lone')], ['lone']);
});

test('personStats: what each person started, delivered, still runs, and its cumulated cost; crown to the best shipper', () => {
  const l = sample();
  l.nodes.push(node({ id: 'c', parent: 't', who: 'joachim', state: 'done', usd: 0.5 }), node({ id: 'old', kind: 'topic', who: 'joachim', context: true }));
  const st = personStats(l);
  assert.deepEqual(st.get('blair'), { topics: 1, threads: 3, done: 0, active: 1, cards: 0, usd: 4, costed: true });
  assert.deepEqual(st.get('joachim'), { topics: 0, threads: 2, done: 1, active: 1, cards: 0, usd: 1.5, costed: true });
  assert.equal(st.get('mini')!.cards, 1);
  assert.deepEqual([...bestShippers(st)], ['joachim']);
  st.get('blair')!.done = 1;
  assert.deepEqual([...bestShippers(st)].sort(), ['blair', 'joachim'], 'a tie: both crowned');
  assert.equal(bestShippers(personStats(L([node({ id: 'x' }), node({ id: 'y', who: 'joachim' })]))).size, 0, 'nobody shipped: no crown');
  assert.equal(bestShippers(personStats(L([node({ id: 'x', state: 'done' })]))).size, 0, 'alone: no crown');
});

test('byAgent: one lane per agent in charge, cards on their proposer, the initiator kept; stats and crown per agent', () => {
  const l = sample();
  for (const n of l.nodes) if (n.kind !== 'card') n.owner = 'mini';
  l.nodes.find(n => n.id === 'b')!.owner = 'zoe';
  l.nodes.find(n => n.id === 'a')!.state = 'done';
  const v = byAgent(l);
  const by = Object.fromEntries(v.nodes.map(n => [n.id, n]));
  assert.deepEqual([by.a.who, (by.a as any).initiator], ['mini', 'blair']);
  assert.deepEqual([by.b.who, (by.b as any).initiator], ['zoe', 'joachim']);
  assert.equal(by['card:m1'].who, 'mini');
  const g = lanes(prepare(v, false), '7d', true);
  assert.deepEqual(g.lanes.map(x => [x.who, x.agent]), [['mini', true], ['zoe', true]]);
  assert.equal(g.edges.find(e => e.to === 'b')!.cross, true, 'handed to another agent');
  assert.equal(g.edges.find(e => e.to === 'a')!.cross, false);
  const st = personStats(v);
  assert.equal(st.get('mini')!.done, 1);
  assert.deepEqual([...bestShippers(st)], ['mini']);
});
