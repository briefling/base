import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, idTime, feedGrouped, namesPlus, pluginRunInfo, pluginRuns, type FeedItem } from '../src/feed.ts';
import { newPaging, onPage, cursorAt } from '../src/paging.ts';
import type { Message, PublicThread } from '../../protocol/frames.ts';

const T = 1_790_000_000_000; // Oct 2026
const hid = (at: number, tail = 'abcdefabcdef') => at.toString(36) + tail;
const msg = (at: number, extra: Partial<Message> = {}): Message =>
  ({ id: hid(at), thread: 'general-s', author: { kind: 'human', id: 'u1' }, type: 'text', text: `m${at}`, at, ...extra });
const topic = (id: string, extra: Partial<PublicThread> = {}): PublicThread =>
  ({ id, space: 's', title: id, owner: 'milan', kind: 'topic', state: 'calm', updatedAt: T + 1e6, version: 1, ...extra });
const keys = (xs: FeedItem[]) => xs.map(x => x.kind === 'msg' ? `m@${x.at - T}` : `t:${x.f.id}@${x.at - T}`);
const NONE = { msgs: null, topics: null };

test('idTime: the time in a hub id, also through « <msg>-t »; null for other shapes', () => {
  assert.equal(idTime(hid(T)), T);
  assert.equal(idTime(`${hid(T)}-t`), T);
  assert.equal(idTime('general-s'), null);
  assert.equal(idTime('t1'), null);
  assert.equal(idTime('ZZZ' + 'abcdefabcdef'), null);       // not base 36 lower case
  assert.equal(idTime('1' + 'abcdefabcdef'), null);         // 1 ms after 1970: not a timestamp
});

test('a topic opened from a General message replaces that message, at its time', () => {
  const m1 = msg(T + 10), m2 = msg(T + 20, { subtopic: `${hid(T + 20)}-t` }), m3 = msg(T + 30);
  const f = topic(`${hid(T + 20)}-t`, { from: 'general-s', fromMsg: m2.id });
  assert.deepEqual(keys(buildFeed([m1, m2, m3], [f], NONE).items), ['m@10', `t:${f.id}@20`, 'm@30']);
});

test('the topic replaces its message even before the message carries `subtopic`', () => {
  const m = msg(T + 20), f = topic(`${hid(T + 20)}-t`, { fromMsg: m.id });
  assert.deepEqual(keys(buildFeed([m], [f], NONE).items), [`t:${f.id}@20`]);
});

test('a « + Topic » topic shows at its creation time (from its id), not at its last activity', () => {
  const f = topic(hid(T + 15, '000000000001'), { updatedAt: T + 99 });
  assert.deepEqual(keys(buildFeed([msg(T + 10), msg(T + 20)], [f], NONE).items), ['m@10', `t:${f.id}@15`, 'm@20']);
});

test('a topic whose id carries no time falls back to its last activity', () => {
  assert.deepEqual(keys(buildFeed([msg(T + 10)], [topic('t1', { updatedAt: T + 5 })], NONE).items), ['t:t1@5', 'm@10']);
});

test('a General message whose topic is not listed (archived, not loaded) stays a message', () => {
  const m = msg(T + 10, { subtopic: 'gone-t' });
  const f = buildFeed([m], [], NONE);
  assert.deepEqual(f.items.map(x => x.kind), ['msg']);
});

test('nothing twice: a topic is one card even when its message and its page both arrived', () => {
  const m = msg(T + 10, { subtopic: `${hid(T + 10)}-t` });
  const f = topic(`${hid(T + 10)}-t`, { fromMsg: m.id });
  const out = buildFeed([m, m], [f, f], NONE).items;
  assert.equal(out.filter(x => x.kind === 'topic').length, 1);
  assert.equal(out.filter(x => x.kind === 'msg').length, 0);
});

test('no gap: items older than the most recent edge of the two sources are held back', () => {
  const old = topic(hid(T + 5, '000000000002')), recent = topic(hid(T + 50, '000000000003'));
  // General still has messages before T+40; the thread pages are complete down to T+20.
  const f = buildFeed([msg(T + 40), msg(T + 60)], [old, recent], { msgs: T + 40, topics: T + 20 });
  assert.deepEqual(keys(f.items), ['m@40', `t:${recent.id}@50`, 'm@60']);
  assert.equal(f.floor, T + 40);
  assert.deepEqual(f.load, { msgs: true, topics: false }); // General binds: page its history
});

test('the thread pages bind when they reach less far back: page them, hold the older messages', () => {
  const f = buildFeed([msg(T + 10), msg(T + 60)], [], { msgs: null, topics: T + 30 });
  assert.deepEqual(keys(f.items), ['m@60']);
  assert.deepEqual(f.load, { msgs: false, topics: true });
});

test('both sources at their start: everything shows, nothing to load', () => {
  const f = buildFeed([msg(T + 1)], [topic('t1', { updatedAt: T })], NONE);
  assert.equal(f.floor, null);
  assert.deepEqual(f.load, { msgs: false, topics: false });
  assert.equal(f.items.length, 2);
});

test('feedGrouped: a gateway notice neither groups nor breaks the run of its author', () => {
  const items = buildFeed([msg(T + 10), msg(T + 20, { notice: true }), msg(T + 30)], [], NONE).items;
  assert.deepEqual(keys(items.filter(x => feedGrouped(items).has(x))), ['m@30']);
});

test('feedGrouped: a topic card groups as a message of its author, and so does the message after it', () => {
  const m = msg(T + 20, { subtopic: `${hid(T + 20)}-t` });
  const items = buildFeed([msg(T + 10), m, msg(T + 30), msg(T + 40, { author: { kind: 'human', id: 'u2' } }), msg(T + 50)],
    [topic(`${hid(T + 20)}-t`, { fromMsg: m.id })], NONE).items;
  assert.deepEqual(keys(items.filter(x => feedGrouped(items).has(x))), ['t:' + `${hid(T + 20)}-t@20`, 'm@30']);
});

test('feedGrouped: a « + Topic » card takes its author from the topic; none = never grouped', () => {
  const items = buildFeed([msg(T + 10), msg(T + 30)], [topic(hid(T + 20, 'xxxxxxxxxxxx'), { author: 'u1' }), topic(hid(T + 25, 'yyyyyyyyyyyy'))], NONE).items;
  assert.deepEqual(keys(items.filter(x => feedGrouped(items).has(x))), [`t:${hid(T + 20, 'xxxxxxxxxxxx')}@20`]);
});

test('feedGrouped: a topic an agent opened on its own never groups under a human of the same id, its own run does', () => {
  const agentTopic = topic(hid(T + 20, 'xxxxxxxxxxxx'), { author: 'u1', authorAgent: true });
  const items = buildFeed([msg(T + 10), msg(T + 30, { author: { kind: 'agent', id: 'u1' } })], [agentTopic], NONE).items;
  assert.deepEqual(keys(items.filter(x => feedGrouped(items).has(x))), ['m@30'], 'only the agent message after the agent card');
});

test('feedGrouped: 30 min between two items by default, the gap is a parameter', () => {
  const items = buildFeed([msg(T), msg(T + 29 * 60_000), msg(T + 60 * 60_000)], [], NONE).items;
  assert.deepEqual(feedGrouped(items).size, 1);
  assert.deepEqual(feedGrouped(items, 5 * 60_000).size, 0);
});

test('cursorAt: the activity time of the hub cursor, null at the end or before the sync', () => {
  const p = newPaging();
  assert.equal(cursorAt(p, 's'), null);
  onPage(p, 's', `${T}.abc-t`);
  assert.equal(cursorAt(p, 's'), T);
  onPage(p, 's', null);
  assert.equal(cursorAt(p, 's'), null);
  onPage(p, 's', 'weird');
  assert.equal(cursorAt(p, 's'), null);
});

test('a feed without General pages the topics alone: held back under the cursor, no gap nor duplicate after the next page', () => {
  const ids = [10, 20, 30, 40].map(d => hid(T + d, '00000000000' + d % 10));
  const tp = ids.map((id, i) => topic(id, { updatedAt: T + 100 + i }));
  // Page 1 = the two most active; its cursor sits at the oldest activity loaded (T + 102), above every creation time.
  const p1 = buildFeed([], tp.slice(2), { msgs: null, topics: T + 102 });
  assert.deepEqual([p1.items.length, p1.floor, p1.load], [0, T + 102, { msgs: false, topics: true }]);
  const p2 = buildFeed([], tp, { msgs: null, topics: null });
  assert.deepEqual(keys(p2.items), ids.map((id, i) => `t:${id}@${[10, 20, 30, 40][i]}`));
  assert.equal(new Set(p2.items.map(x => keys([x])[0])).size, 4);
});

const plug = (at: number, agents: string[], to = '0.3.76', from = '0.3.74') =>
  msg(at, { author: { kind: 'system', id: 'briefling' }, notice: true, plugin: { from, to, agents }, text: 'x' });

test('pluginRuns: neighbouring plugin notices to one version merge, other notices do not break the run', () => {
  const items = buildFeed([plug(T, ['milan']), msg(T + 1, { notice: true, author: { kind: 'agent', id: 'radar' } }),
    plug(T + 2, ['gideon', 'radar']), plug(T + 3, ['gaston'], '0.3.76', '0.3.75')], [], NONE).items;
  const { runs, hidden } = pluginRuns(items);
  assert.deepEqual([...runs.keys()], [hid(T)]);
  assert.deepEqual([...hidden], [hid(T + 2), hid(T + 3)]);
  assert.deepEqual(pluginRunInfo(runs.get(hid(T))!), { to: '0.3.76', agents: ['milan', 'gideon', 'radar', 'gaston'], from: ['0.3.74', '0.3.75'] });
});

test('pluginRuns: a message, a topic or another version starts a new run; text-only notices stay apart', () => {
  const items = buildFeed([plug(T, ['milan']), msg(T + 1), plug(T + 2, ['gideon']), plug(T + 3, ['radar'], '0.3.77'),
    msg(T + 4, { notice: true, text: 'Gaston · briefling plugin updated automatically, 0.3.74 → 0.3.76' }), plug(T + 5, ['camille'], '0.3.77')],
  [], NONE).items;
  const { runs, hidden } = pluginRuns(items);
  assert.deepEqual([...runs.keys()], [hid(T), hid(T + 2), hid(T + 3)]);
  assert.deepEqual([...hidden], [hid(T + 5)], 'the old text-only notice between them does not break the run');
  const withTopic = [...buildFeed([plug(T, ['milan'])], [], NONE).items, { kind: 'topic', at: T + 1, f: topic('t1') } as FeedItem, ...buildFeed([plug(T + 2, ['gideon'])], [], NONE).items];
  assert.equal(pluginRuns(withTopic).runs.size, 2, 'a topic card breaks the run');
});

test('namesPlus: up to 3 names, then +N', () => {
  assert.equal(namesPlus([]), '');
  assert.equal(namesPlus(['Milan']), 'Milan');
  assert.equal(namesPlus(['Milan', 'Gideon', 'Radar']), 'Milan, Gideon, Radar');
  assert.equal(namesPlus(['Milan', 'Gideon', 'Radar', 'Gaston', 'Camille']), 'Milan, Gideon, Radar +2');
  assert.equal(namesPlus(['a', 'b'], 1), 'a +1');
});
