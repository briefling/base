import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnOf, myTurn, turnLabel, summaryTone, summaryWaits } from '../src/turnof.ts';
import { isYours } from '../src/notify.ts';
import { isMyTurn } from '../../protocol/notify.ts';
import type { Person } from '../../protocol/frames.ts';

const dir: Person[] = [
  { id: 'blair', name: 'Blair Dalton', kind: 'human' },
  { id: 'jerome', name: 'Jérôme Guyon', kind: 'human' },
  { id: 'anna', name: 'Anna', kind: 'human' },
  { id: 'old', name: 'Old Timer', kind: 'human', gone: true },
  { id: 'kiki', name: 'Kiki', kind: 'agent' },
];
const you = (people?: string[]) => ({ state: 'you' as const, people });

test('turnOf: Your turn of someone else names the humans concerned that are still members', () => {
  assert.deepEqual(turnOf(you(['jerome']), 'blair', dir), ['jerome']);
  assert.deepEqual(turnOf(you(['jerome', 'old', 'anna', 'jerome']), 'blair', dir), ['jerome', 'anna']);
});

test('turnOf: mine when I am concerned, when nobody is known, or only ex-members (push rule: everyone)', () => {
  assert.equal(turnOf(you(['jerome', 'blair']), 'blair', dir), null);
  assert.equal(turnOf(you(undefined), 'blair', dir), null);
  assert.equal(turnOf(you([]), 'blair', dir), null);
  assert.equal(turnOf(you(['old']), 'blair', dir), null);
});

test('turnOf: only a Your turn thread; directory not loaded = people as is', () => {
  for (const state of ['run', 'wait', 'calm', 'idea', 'done'] as const) assert.equal(turnOf({ state, people: ['jerome'] }, 'blair', dir), null);
  assert.deepEqual(turnOf(you(['jerome', 'old']), 'blair', undefined), ['jerome', 'old']);
});

test('myTurn: what the counters and Now keep', () => {
  assert.equal(myTurn(you(['blair']), 'blair', dir), true);
  assert.equal(myTurn(you(undefined), 'blair', dir), true);
  assert.equal(myTurn(you(['jerome']), 'blair', dir), false);
  assert.equal(myTurn({ state: 'calm', people: ['blair'] }, 'blair', dir), false);
});

test('myTurn in a space I muted: only a thread naming me in its people (no « everyone » fallback, Blair Nov 14)', () => {
  assert.equal(myTurn(you(['blair']), 'blair', dir, true), true, 'named: kept (the Jyd topic case)');
  assert.equal(myTurn(you(['jerome', 'blair']), 'blair', dir, true), true);
  assert.equal(myTurn(you(undefined), 'blair', dir, true), false, 'board thread, nobody known: not mine any more');
  assert.equal(myTurn(you([]), 'blair', dir, true), false);
  assert.equal(myTurn(you(['old']), 'blair', dir, true), false, 'only ex-members known');
  assert.equal(myTurn(you(['jerome']), 'blair', dir, true), false);
  assert.equal(myTurn(you(['blair']), 'blair', undefined, true), true, 'directory not loaded: people as is');
  assert.equal(myTurn(you(undefined), 'blair', dir, false), true, 'space not muted: fallback unchanged');
});

test('turnLabel: first name, extra count, full names for the tooltip; unknown id falls back to its short form', () => {
  assert.deepEqual(turnLabel(['jerome'], dir), { name: 'Jérôme', more: 0, all: ['Jérôme Guyon'] });
  assert.deepEqual(turnLabel(['jerome', 'anna'], dir), { name: 'Jérôme', more: 1, all: ['Jérôme Guyon', 'Anna'] });
  assert.deepEqual(turnLabel(['abcdef123'], undefined), { name: 'abcdef', more: 0, all: ['abcdef'] });
});

test('summaryTone: green when the agent declared done, orange when Your turn for me, blue otherwise', () => {
  const done = { kind: 'done' as const, at: 1 };
  assert.equal(summaryTone({ state: 'calm', outcome: done }, 'blair', dir), 'done');
  assert.equal(summaryTone({ state: 'you', people: ['blair'], outcome: done }, 'blair', dir), 'done');
  assert.equal(summaryTone({ state: 'run', outcome: done }, 'blair', dir), 'run');
  assert.equal(summaryTone({ state: 'you', people: ['blair'] }, 'blair', dir), 'you');
  assert.equal(summaryTone({ state: 'you' }, 'blair', dir), 'you');
  assert.equal(summaryTone({ state: 'you', people: ['jerome'] }, 'blair', dir), 'run');
  for (const state of ['run', 'wait', 'calm', 'idea', 'done'] as const) assert.equal(summaryTone({ state }, 'blair', dir), 'run');
  assert.equal(summaryTone({ state: 'calm', outcome: { kind: 'waiting', at: 1, action: 'x' } }, 'blair', dir), 'run');
});

test('summaryWaits: the « Waiting on » line shows only while the outcome is waiting', () => {
  assert.equal(summaryWaits({ outcome: { kind: 'waiting', at: 1 } }, 'Blair: restart'), true);
  assert.equal(summaryWaits({ outcome: { kind: 'done', at: 2 } }, 'Blair: restart'), false); // Done button
  assert.equal(summaryWaits({ outcome: undefined }, 'Blair: restart'), false); // cleared by a trusted message
  assert.equal(summaryWaits({}, 'Blair: restart'), false);
  assert.equal(summaryWaits({ outcome: { kind: 'waiting', at: 1 } }, undefined), false);
  assert.equal(summaryWaits({ outcome: { kind: 'waiting', at: 1 } }, ''), false);
});

test('isMyTurn (hub push badge) counts exactly what the client counted before: thread, not archived, Your turn for me', () => {
  const members = dir.filter(p => p.kind === 'human' && !p.gone).map(p => p.id);
  const peoples = [undefined, [], ['blair'], ['jerome'], ['jerome', 'blair'], ['old'], ['old', 'anna'], ['blair', 'blair']];
  let n = 0;
  for (const kind of [undefined, 'topic'] as const) for (const archived of [undefined, { by: 'x', at: 1 }]) for (const state of ['you', 'run', 'calm'] as const)
    for (const people of peoples) for (const me of ['blair', 'anna', null]) for (const d of [dir, undefined]) for (const muted of [false, true]) {
      const f = { id: 't', space: 's', title: 'x', kind, archived, state, people } as any;
      const before = isYours(f) && myTurn(f, me, d, muted);
      assert.equal(isMyTurn(f, me, d && members, muted), before, JSON.stringify({ kind, archived, state, people, me, d: !!d, muted }));
      n += +before;
    }
  assert.ok(n > 10, 'the grid has Your turn cases');
});
