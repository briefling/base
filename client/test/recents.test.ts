import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowTree, rowClass, recentsTree, recentsFlat, recentsTags, recentsUnread, tagHue, TAG_HUES, tagTerms, toggleTag, type RecentsOpts, type RecentRow } from '../src/recents.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const T = 1_790_000_000_000;
const th = (id: string, at: number, extra: Partial<PublicThread> = {}): PublicThread =>
  ({ id, space: 's', title: id, owner: 'milan', kind: 'thread', state: 'calm', updatedAt: T + at, version: 1, ...extra });
const topic = (id: string, at: number, extra: Partial<PublicThread> = {}) => th(id, at, { kind: 'topic', ...extra });
const ALL: RecentsOpts = { filter: 'all', q: '', unread: () => false, active: () => false };
const shape = (rows: RecentRow[]) => rows.map(r => `${'  '.repeat(r.depth)}${r.f.id}${r.ctx ? '?' : ''}`);

// The refacto topic of Blair's mock-up: four threads, then « Exchanges » and settingsView opened from it.
const world = () => [
  topic('refacto', 10, { spawned: ['iface', 'mem', 'ex'] }),
  th('iface', 20, { from: 'refacto', state: 'done' }),
  th('mem', 30, { from: 'refacto', state: 'done' }),
  th('ex', 40, { from: 'refacto', state: 'you', spawned: ['settings'] }),
  th('settings', 90, { from: 'ex', state: 'run' }),
  topic('radar', 50, { spawned: ['open'] }),
  th('open', 60, { from: 'radar', state: 'done' }),
  topic('fresh', 80),
  topic('general-s', 999, { general: true }),
  topic('old', 1, { archived: { by: 'u1', at: T } }),
  topic('elsewhere', 999, { space: 'other' }),
];

test('topics on the rail by the last activity of their whole branch, threads in creation order under their parent', () => {
  const rows = recentsTree(world(), 's', ALL);
  // refacto (10) wins through settings (90); fresh (80) before radar (60); General, archived and other spaces left out.
  assert.deepEqual(shape(rows), ['refacto', '  iface', '  mem', '  ex', '    settings', 'fresh', 'radar', '  open']);
  assert.equal(rows[0].at, T + 90, 'a rail row carries its branch activity');
  assert.equal(rows[1].at, T + 20, 'a branch row its own');
  assert.equal(rows[0].kids, 4);
});

test('lines: the rail runs from the first topic to the last, a branch line runs while a sibling follows', () => {
  const rows = recentsTree(world(), 's', ALL), by = new Map(rows.map(r => [r.f.id, r]));
  assert.deepEqual(by.get('iface')!.rails, [0], 'column 0: the rail (mem follows, then fresh)');
  assert.deepEqual(by.get('ex')!.rails, [0], 'last child of refacto: the rail goes on to fresh');
  assert.equal(by.get('ex')!.down, true, 'settings hangs under it');
  assert.deepEqual(by.get('settings')!.rails, [0], 'column 1 ends: ex has no later sibling');
  assert.equal(by.get('settings')!.down, false);
  assert.deepEqual(by.get('open')!.rails, [], 'last row: nothing goes on');
  assert.equal(by.get('refacto')!.down, true);
  assert.equal(by.get('open')!.down, false);
});

test('a deeper row keeps the line of an ancestor whose sibling comes later', () => {
  const xs = [topic('t', 1, { spawned: ['a', 'b'] }), th('a', 2, { spawned: ['a1'] }), th('a1', 3), th('b', 4)];
  const rows = recentsTree(xs, 's', ALL);
  assert.deepEqual(shape(rows), ['t', '  a', '    a1', '  b']);
  assert.deepEqual(rows[2].rails, [0], 'a1: column 0 goes on to b (a sibling of a)');
  assert.deepEqual(rows[3].rails, [], 'b: last of the list');
});

test('« Unread »: the unread rows, their ancestors kept as faded context', () => {
  const un = new Set(['settings', 'fresh']);
  const rows = recentsTree(world(), 's', { ...ALL, filter: 'unread', unread: f => un.has(f.id) });
  assert.deepEqual(shape(rows), ['refacto?', '  ex?', '    settings', 'fresh']);
  assert.equal(recentsUnread(world(), 's', f => un.has(f.id)), 2);
});

test('« Active »: what moves as shown, and its ancestors', () => {
  const rows = recentsTree(world(), 's', { ...ALL, filter: 'active', active: f => f.state === 'run' || f.state === 'you' });
  assert.deepEqual(shape(rows), ['refacto?', '  ex', '    settings']);
});

test('text: folded words on the title; a matching topic brings its branch, a matching thread its ancestors', () => {
  const xs = world().map(f => f.id === 'settings' ? { ...f, title: 'Sortir settingsView de main.ts' } : f);
  assert.deepEqual(shape(recentsTree(xs, 's', { ...ALL, q: 'SETTINGSVIEW main' })), ['refacto?', '  ex?', '    settings']);
  assert.deepEqual(shape(recentsTree(xs, 's', { ...ALL, q: 'radar' })), ['radar', '  open']);
  const named = [topic('h', 1, { title: 'raw', heading: { text: 'Récents en arbre', by: { kind: 'agent', id: 'milan' }, at: 0 } })];
  assert.deepEqual(shape(recentsTree(named, 's', { ...ALL, q: 'recents' })), ['h'], 'a topic matches by its heading, accents folded');
  assert.deepEqual(recentsTree(xs, 's', { ...ALL, q: 'nothing' }), []);
});

test('threads outside every loaded topic go on the rail, with their own children; archived ones stay off it', () => {
  const xs = [
    th('loose', 5, { spawned: ['kid'] }), th('kid', 7, { from: 'loose' }),
    th('orphan', 9, { from: 'not-loaded-topic' }),        // its topic is on a page not loaded yet
    th('gone', 99, { archived: { by: 'u1', at: T } }),
  ];
  assert.deepEqual(shape(recentsTree(xs, 's', ALL)), ['orphan', 'loose', '  kid']);
});

test('a cycle in spawned never loops nor shows a thread twice', () => {
  const xs = [topic('t', 1, { spawned: ['a'] }), th('a', 2, { spawned: ['b'] }), th('b', 3, { spawned: ['a'] })];
  assert.deepEqual(shape(recentsTree(xs, 's', ALL)), ['t', '  a', '    b']);
});

test('⌘K with nothing typed: the same conversations, flat, each by its own activity, the topic of a thread joined', () => {
  const flat = recentsFlat(world(), 's');
  assert.deepEqual(flat.map(x => x.f.id), ['settings', 'fresh', 'open', 'radar', 'ex', 'mem', 'iface', 'refacto']);
  assert.equal(flat[0].root?.id, 'refacto');
  assert.equal(flat[1].root, undefined);
  assert.deepEqual(recentsFlat(world(), undefined).map(x => x.f.id).slice(0, 2), ['elsewhere', 'settings'], 'from Now: every space');
  assert.equal(recentsFlat(world(), 's', 3).length, 3);
});


// ---------------------------------------------------------------- tags (protocol/tags.ts): pills and `#tag` filters
const tg = (list: string[]) => ({ tags: { list, by: { kind: 'agent' as const, id: 'milan' }, at: T } });

test('#tag filters on the row\'s own tags (prefix while typed), parents kept as context, with the free words and the state filter', () => {
  const w = world();
  w[0] = { ...w[0], ...tg(['refactor', 'hub']) }; w[2] = { ...w[2], ...tg(['memory']) }; w[4] = { ...w[4], ...tg(['ui']) };
  w[7] = { ...w[7], ...tg(['ui', 'css']) };
  assert.deepEqual(shape(recentsTree(w, 's', { ...ALL, q: '#ui' })), ['refacto?', '  ex?', '    settings', 'fresh']);
  assert.deepEqual(shape(recentsTree(w, 's', { ...ALL, q: '#UI #css' })), ['fresh']);
  assert.deepEqual(shape(recentsTree(w, 's', { ...ALL, q: '#mem' })), ['refacto?', '  mem']);
  assert.deepEqual(shape(recentsTree(w, 's', { ...ALL, q: 'settings #ui' })), ['refacto?', '  ex?', '    settings']);
  assert.deepEqual(shape(recentsTree(w, 's', { ...ALL, q: '#nope' })), []);
  assert.equal(recentsTree(w, 's', { ...ALL, q: '#' }).length, recentsTree(w, 's', ALL).length, 'a lone # filters nothing');
  assert.deepEqual(recentsTags(w, 's'), ['ui', 'css', 'hub', 'memory', 'refactor']);
  assert.deepEqual(tagTerms('Fix #UI  #'), ['ui']);
});

test('toggleTag: a pill or a filter adds `#tag` to the filter, a second tap takes it out, other words kept', () => {
  assert.equal(toggleTag('', 'ui'), '#ui');
  assert.equal(toggleTag('header', 'ui'), 'header #ui');
  assert.equal(toggleTag('header #UI  #css', 'ui'), 'header #css');
  assert.equal(toggleTag('#ui', 'ui'), '');
});

// Now (Nov 13): the same tree over every space, Active only, the branches holding one of my turns first.
const nowWorld = () => [
  topic('chat', 50, { space: 'a', spawned: ['build'] }),
  th('build', 95, { space: 'a', from: 'chat', state: 'run' }),
  topic('quiet', 99, { space: 'a' }),
  th('loose', 10, { space: 'b', state: 'you' }),
  topic('plan', 30, { space: 'b', spawned: ['doc', 'ask'] }),
  th('doc', 31, { space: 'b', from: 'plan', state: 'done' }),
  th('ask', 32, { space: 'b', from: 'plan', state: 'you' }),
  th('theirs', 90, { space: 'c', state: 'you' }),
];
const NOW = { unread: () => false, active: (f: PublicThread) => f.state === 'run' || f.state === 'you' };
const mineOf = (ids: string[]) => (f: PublicThread) => ids.includes(f.id);

test('now: every space, Active rows only, my branches first in activity order, the rest after', () => {
  // theirs (90) is Your turn of someone else: active, not mine, so after my branches; quiet and doc are left out.
  const rows = nowTree(nowWorld(), NOW, mineOf(['loose', 'ask']));
  assert.deepEqual(shape(rows), ['plan?', '  ask', 'loose', 'chat?', '  build', 'theirs']);
  assert.deepEqual([...new Set(rows.map(r => r.f.space))], ['b', 'a', 'c'], 'spaces mixed on one rail');
});

test('now: a turn of mine shows even when its state is not Active as shown', () => {
  const rows = nowTree(nowWorld(), { ...NOW, active: () => false }, mineOf(['doc']));
  assert.deepEqual(shape(rows), ['plan?', '  doc']);
});

test('now: the lines follow the new order (the rail ends on the last row, a moved branch keeps its elbow)', () => {
  const rows = nowTree(nowWorld(), NOW, mineOf(['ask'])), by = new Map(rows.map(r => [r.f.id, r]));
  assert.equal(shape(rows)[0], 'plan?');
  assert.deepEqual(by.get('ask')!.rails, [0], 'rail goes on to the next branch');
  assert.equal(by.get('plan')!.down, true);
  assert.equal(rows.at(-1)!.down, false, 'nothing after the last row');
  assert.deepEqual(nowTree([], NOW, () => true), [], 'nothing moving: no row');
});

test('now: a muted space only brings my turns (and the topic they hang from)', () => {
  const all = nowTree(nowWorld(), NOW, mineOf(['loose', 'ask']));
  for (const sp of new Set(all.map(r => r.f.space))) {
    const rows = nowTree(nowWorld(), NOW, mineOf(['loose', 'ask']), new Set([sp]));
    const kept = rows.filter(r => r.f.space === sp && !r.ctx).map(r => r.f.id);
    assert.ok(kept.every(id => ['loose', 'ask'].includes(id)), `${sp}: ${kept}`);
    assert.deepEqual(rows.filter(r => r.f.space !== sp).map(r => r.f.id), all.filter(r => r.f.space !== sp).map(r => r.f.id), 'other spaces untouched');
  }
  assert.deepEqual(shape(nowTree(nowWorld(), NOW, mineOf(['loose', 'ask']), new Set(['a', 'b']))), ['plan?', '  ask', 'loose', 'theirs'], 'a\'s thread left Now, my turns of b stay');
});

test('tagHue: a stable tint class per tag, spread over the TAG_HUES classes', () => {
  // FNV-1a 32-bit, pinned so a tag keeps its colour across releases.
  assert.equal(tagHue('ui'), tagHue('ui'));
  assert.equal(tagHue(''), `tgh${2166136261 % TAG_HUES}`);
  assert.equal(tagHue('a'), `tgh${0xe40c292c % TAG_HUES}`);
  assert.match(tagHue('morphdom'), /^tgh[0-7]$/);
  const seen = new Set(['spaces', 'threads', 'agents', 'e2e', 'plugin', 'ui', 'audio', 'preview', 'cards', 'notify', 'sidebar', 'morphdom', 'flow', 'hub'].map(tagHue));
  assert.ok(seen.size >= 5, `only ${seen.size} tints for 14 tags`);
});

test('rowClass: grey title once read, except Your turn and in progress; archived and context keep their fade', () => {
  const r = (extra: Partial<PublicThread> = {}, depth = 1, ctx = false) => ({ f: th('a', 0, extra), depth, ctx });
  const look = { unread: false, mark: 'idle' as const, mine: false, sel: false };
  assert.equal(rowClass(r(), look), 'rc-row d1');
  assert.equal(rowClass(r(), { ...look, unread: true }), 'rc-row d1 unread');
  assert.equal(rowClass(r(), { ...look, mark: 'you' }), 'rc-row d1 you');
  assert.equal(rowClass(r(), { ...look, mark: 'run' }), 'rc-row d1 rc-run');
  for (const m of ['done', 'wait', 'later', 'idle'] as const) assert.doesNotMatch(rowClass(r(), { ...look, mark: m }), /\b(you|rc-run)\b/, m);
  assert.equal(rowClass(r(), { ...look, mark: 'archived' }), 'rc-row d1 rc-arch');
  assert.equal(rowClass(r({}, 0, true), { ...look, mark: 'run' }), 'rc-row d0 ctx rc-run');
  assert.equal(rowClass(r({ tags: { list: ['ui'], by: { kind: 'agent', id: 'x' }, at: 1 } }), { unread: true, mark: 'you', mine: true, sel: true }), 'rc-row d1 tagged unread you mine sel');
  assert.equal(rowClass(r({ tags: { list: ['ui'], by: { kind: 'agent', id: 'x' }, at: 1 } }, 0), look), 'rc-row d0', 'a rail row never gets « tagged »');
});
