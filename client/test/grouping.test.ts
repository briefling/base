import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP_LOUNGE, GAP_THREAD, groupPrev, groupsUnder } from '../src/grouping.ts';

const T = 1_790_000_000_000;
const u = (id: string, kind = 'human') => ({ kind, id });
const it = (author: { kind: string; id: string } | null, at: number, lead = true) => ({ author, at, lead });

test('groupsUnder: same author, close enough, the previous item can lead', () => {
  assert.equal(groupsUnder(it(u('a'), T), it(u('a'), T + 60_000), GAP_THREAD), true);
});

test('groupsUnder: nothing before, another author, same id of another kind: a header', () => {
  assert.equal(groupsUnder(null, it(u('a'), T), GAP_THREAD), false);
  assert.equal(groupsUnder(it(u('a'), T), it(u('b'), T + 1), GAP_THREAD), false);
  assert.equal(groupsUnder(it(u('a', 'agent'), T), it(u('a'), T + 1), GAP_THREAD), false);
});

test('groupsUnder: a previous item that cannot lead (a card of another kind) or an unknown author: a header', () => {
  assert.equal(groupsUnder(it(u('a'), T, false), it(u('a'), T + 1), GAP_THREAD), false);
  assert.equal(groupsUnder(it(null, T), it(null, T + 1), GAP_THREAD), false);
  assert.equal(groupsUnder(it(u('a'), T), it(null, T + 1), GAP_THREAD), false);
});

test('groupsUnder: 5 min in a thread, 30 min in the Lounge, strict bound', () => {
  assert.equal(groupsUnder(it(u('a'), T), it(u('a'), T + 15 * 60_000), GAP_THREAD), false);
  assert.equal(groupsUnder(it(u('a'), T), it(u('a'), T + 15 * 60_000), GAP_LOUNGE), true);
  assert.equal(groupsUnder(it(u('a'), T), it(u('a'), T + GAP_LOUNGE - 1), GAP_LOUNGE), true);
  assert.equal(groupsUnder(it(u('a'), T), it(u('a'), T + GAP_LOUNGE), GAP_LOUNGE), false);
});

test('groupPrev: a gateway notice is skipped, so it never breaks a run of the same author', () => {
  type M = { id: string; notice?: true };
  const a: M = { id: 'a' }, n1: M = { id: 'n1', notice: true }, n2: M = { id: 'n2', notice: true }, b: M = { id: 'b' };
  const all = [a, n1, n2, b];
  assert.equal(groupPrev(all, 3), a);
  assert.equal(groupPrev(all, 1), a);
  assert.equal(groupPrev(all, 0), null);
  assert.equal(groupPrev([n1, b], 1), null);
});
