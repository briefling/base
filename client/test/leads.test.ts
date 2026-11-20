import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadTags, recallGroups, recallUnder, undecided } from '../src/leadsview.ts';

const m = (id: string, at: number, kind: 'human' | 'agent', deleted = false) => ({ id, at, author: { kind, id: kind === 'agent' ? 'gaston' : 'blair' }, ...(deleted ? { deleted: { at, by: 'gaston' } } : {}) });

test('recallUnder: the first agent reply after the recall, nothing before it or without one', () => {
  const th = { leadsRecalled: [{ id: 'l', from: 'o', fromTitle: 'O', what: 'x', at: 10 }] };
  assert.equal(recallUnder(th, [m('a', 5, 'agent'), m('h', 9, 'human'), m('r', 12, 'agent'), m('r2', 14, 'agent')]), 'r');
  assert.equal(recallUnder(th, [m('h', 9, 'human')]), null, 'no reply yet');
  assert.equal(recallUnder(th, [m('d', 11, 'agent', true), m('r', 12, 'agent')]), 'r', 'a deleted reply is skipped');
  assert.equal(recallUnder({}, [m('r', 12, 'agent')]), null, 'nothing recalled');
});

test('recallGroups: one block per closed thread, in recall order; undecided: no decision and no thread opened', () => {
  const r = (id: string, from: string) => ({ id, from });
  assert.deepEqual(recallGroups([r('a', 'o1'), r('b', 'o2'), r('c', 'o1')]).map(g => [g.from, g.rs.map(x => x.id)]), [['o1', ['a', 'c']], ['o2', ['b']]]);
  assert.deepEqual(recallGroups([]), []);
  assert.equal(undecided({}), true);
  assert.equal(undecided({ decided: { how: 'here', by: 'b', at: 1 } }), false);
  assert.equal(undecided({ thread: 't' }), false, 'opened before Nov 18: decided');
});

test('leadTags: each tag once per lead, most used first then by name; untagged leads count for nothing', () => {
  assert.deepEqual(leadTags([{ tags: ['sbx', 'plugin'] }, { tags: ['plugin', 'plugin'] }, {}, { tags: [] }, { tags: ['cost'] }]),
    [{ tag: 'plugin', n: 2 }, { tag: 'cost', n: 1 }, { tag: 'sbx', n: 1 }]);
});
