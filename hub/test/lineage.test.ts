import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segments, spaceLineage, missingParents } from '../src/lineage.ts';
import { LINEAGE_IDLE_MS, LINEAGE_MAX_SEGMENTS, type PublicThread } from '../../protocol/frames.ts';

const H = 3_600_000;
const m = (kind: 'human' | 'agent' | 'system', at: number, author = kind === 'human' ? 'blair' : 'mini') => ({ id: `m${at}`, kind, author, at });

test('segments: human message to the last agent message = work, until the next human = discussion', () => {
  assert.deepEqual(segments([m('human', 0), m('agent', 10), m('agent', 50), m('human', 80), m('agent', 90)]),
    [[0, 50, 1], [50, 80, 0], [80, 90, 1]]);
});

test('segments: a long silence is nothing (no discussion), system lines are ignored', () => {
  const late = 50 + LINEAGE_IDLE_MS + 1;
  assert.deepEqual(segments([m('human', 0), m('agent', 50), m('system', 60), m('human', late), m('agent', late + 5)]),
    [[0, 50, 1], [late, late + 5, 1]]);
});

test('segments: thread opened by the agent (brief first), several humans before an answer, unanswered tail', () => {
  // brief signed by the agent then its work; two human messages before the answer: the turn starts at the first.
  assert.deepEqual(segments([m('agent', 0), m('agent', 20), m('human', 30), m('human', 40), m('agent', 70), m('human', 100)]),
    [[0, 20, 1], [20, 30, 0], [30, 70, 1], [70, 100, 0]]);
  // a human message with no answer yet: nothing (not working), unless the thread is In progress.
  assert.deepEqual(segments([m('human', 0)]), []);
  assert.deepEqual(segments([m('human', 0)], 500), [[0, 500, 1]]);
  assert.deepEqual(segments([m('human', 0), m('agent', 5), m('human', 10)], 500), [[0, 5, 1], [5, 10, 0], [10, 500, 1]]);
  assert.deepEqual(segments([]), []);
});

test('segments: only the latest LINEAGE_MAX_SEGMENTS are kept', () => {
  const msgs = Array.from({ length: LINEAGE_MAX_SEGMENTS * 2 }, (_, i) => [m('human', i * 10 * H), m('agent', i * 10 * H + 1)]).flat();
  const s = segments(msgs);
  assert.equal(s.length, LINEAGE_MAX_SEGMENTS);
  assert.deepEqual(s.at(-1), [(LINEAGE_MAX_SEGMENTS * 2 - 1) * 10 * H, (LINEAGE_MAX_SEGMENTS * 2 - 1) * 10 * H + 1, 1]);
});

const th = (x: Partial<PublicThread> & { id: string }): PublicThread => ({ space: 's', title: x.id, owner: 'mini', state: 'calm', updatedAt: 0, version: 1, ...x } as PublicThread);

test('spaceLineage: topics, threads with their parent and initiator, open cards, ancestors as context', () => {
  const topic = th({ id: 't', kind: 'topic', author: 'joachim', updatedAt: 100 });
  const opened = th({ id: 'a', from: 't', state: 'run', updatedAt: 300, usage: { usd: 1.5 } as any });
  const sub = th({ id: 'b', from: 'old', state: 'calm', outcome: { kind: 'done' } as any, updatedAt: 200 });
  const old = th({ id: 'old', kind: 'topic', author: 'blair', updatedAt: 1 });
  const l = spaceLineage([
    { thread: topic, activity: { messages: [m('human', 100, 'joachim'), { ...m('agent', 110), proposed: { title: 'Next', by: 'mini' } }] } },
    { thread: opened, activity: { opener: 'blair', messages: [m('agent', 150), m('human', 160)] } },
    { thread: sub, activity: { messages: [m('human', 180, 'joachim'), m('agent', 190)] } },
  ], [old], { period: '7d', since: 50, now: 400, trusted: ['blair'] });
  const by = Object.fromEntries(l.nodes.map(n => [n.id, n]));
  assert.deepEqual(by.t, { id: 't', kind: 'topic', title: 't', who: 'joachim', owner: 'mini', state: 'calm', start: 100, last: 110 });
  assert.deepEqual(by.a, { id: 'a', kind: 'thread', title: 'a', parent: 't', who: 'blair', owner: 'mini', state: 'run', usd: 1.5, start: 150, last: 160,
    segs: [[150, 150, 1], [150, 160, 0], [160, 400, 1]] });
  assert.equal(by.b.state, 'done'); // Quiet with a done outcome = Closed
  assert.equal(by.b.who, 'joachim');  // parent outside the period, no opener: first human
  assert.deepEqual(by['card:m110'], { id: 'card:m110', kind: 'card', title: 'Next', parent: 't', who: 'mini', start: 110, last: 110 });
  assert.deepEqual(by.old, { id: 'old', kind: 'topic', title: 'old', who: 'blair', owner: 'mini', state: 'calm', start: 50, last: 1, context: true });
  assert.equal(l.partial, undefined);
});

test('missingParents: one level, deduplicated, known ones skipped', () => {
  assert.deepEqual(missingParents([th({ id: 'a', from: 'x' }), th({ id: 'b', from: 'x' }), th({ id: 'c', from: 'a' }), th({ id: 'd' })], new Set(['a', 'b', 'c', 'd'])), ['x']);
});

test('spaceLineage: General is never a node, the topics opened from it are roots', () => {
  const general = th({ id: 'general-s', kind: 'topic', general: true, author: 'blair', updatedAt: 100 });
  const born = th({ id: 'sub', kind: 'topic', author: 'joachim', from: 'general-s', updatedAt: 120 });
  const opened = th({ id: 'a', from: 'sub', updatedAt: 130 });
  const l = spaceLineage([
    { thread: general, activity: { messages: [m('human', 100), m('human', 105, 'joachim')] } },
    { thread: born, activity: { messages: [m('human', 110, 'joachim')] } },
    { thread: opened, activity: { messages: [m('human', 125, 'joachim'), m('agent', 130)] } },
  ], [general], { period: '7d', since: 50, now: 400, trusted: ['blair'] });
  assert.deepEqual(l.nodes.map(n => n.id), ['sub', 'a']); // neither as a row nor as a context ancestor
  const by = Object.fromEntries(l.nodes.map(n => [n.id, n]));
  assert.equal('parent' in by.sub, false);
  assert.equal(by.a.parent, 'sub');
  // per-person stats are counted from the nodes: blair (General's author) owns no topic any more
  assert.deepEqual(l.nodes.filter(n => n.kind === 'topic').map(n => n.who), ['joachim']);
});

test('missingParents: General is never fetched as an ancestor', () => {
  assert.deepEqual(missingParents([th({ id: 'sub', from: 'general-s' }), th({ id: 'b', from: 'x' })], new Set(['sub', 'b'])), ['x']);
});
