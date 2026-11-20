import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfOf, laterOf, closedOf, shelfCounts, agentDone } from '../src/shelves.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const th = (id: string, state: string, extra: Record<string, unknown> = {}) =>
  ({ id, space: 's', kind: 'thread', state, updatedAt: 0, ...extra }) as unknown as PublicThread;
const done = { outcome: { kind: 'done', at: 1 } }, waiting = { outcome: { kind: 'waiting', action: 'x', at: 1 } };

test('shelf: idea goes to Later; closed, agent-done or archived to Closed; the rest stays in the space list', () => {
  for (const st of ['you', 'run', 'wait', 'calm']) assert.equal(shelfOf(th('a', st)), null, st);
  assert.equal(shelfOf(th('a', 'idea')), 'later');
  assert.equal(shelfOf(th('a', 'done')), 'closed');
  // the agent said "✓ done": Closed once Quiet (seen); while unseen (you) or running again it stays in the list
  assert.equal(shelfOf(th('a', 'calm', done)), 'closed');
  assert.equal(shelfOf(th('a', 'you', done)), null);
  assert.equal(shelfOf(th('a', 'run', done)), null);
  assert.equal(shelfOf(th('a', 'you', waiting)), null);
  // archived wins over the state: an archived idea is in Closed, not in Later
  assert.equal(shelfOf(th('a', 'idea', { archived: { at: 1 } })), 'closed');
  assert.equal(shelfOf(th('a', 'run', { archived: { at: 1 } })), 'closed');
  // topics: only archived ones (they belong to the Lounge otherwise)
  assert.equal(shelfOf(th('a', 'done', { kind: 'topic' })), null);
  assert.equal(shelfOf(th('a', 'calm', { kind: 'topic', ...done })), null);
  assert.equal(shelfOf(th('a', 'calm', { kind: 'topic', archived: { at: 1 } })), 'closed');
});

test('state badge: « ✓ done » instead of Quiet only when shown Quiet and the agent said done', () => {
  assert.equal(agentDone('calm', th('a', 'calm', done)), true);
  assert.equal(agentDone('calm', th('a', 'calm')), false);          // Quiet without outcome keeps Quiet
  assert.equal(agentDone('calm', th('a', 'calm', waiting)), false);
  for (const st of ['you', 'run', 'wait', 'done', 'idea'] as const) assert.equal(agentDone(st, th('a', 'calm', done)), false, st); // queued Quiet shows wait
});

test('Later: ideas of the space only, last activity first', () => {
  const all = [th('old', 'idea', { updatedAt: 1 }), th('new', 'idea', { updatedAt: 3 }), th('run', 'run', { updatedAt: 5 }),
    th('other', 'idea', { space: 'x', updatedAt: 4 }), th('arch', 'idea', { updatedAt: 6, archived: { at: 6 } })];
  assert.deepEqual(laterOf(all, 's').map(f => f.id), ['new', 'old']);
});

test('Closed: one list, finished (last activity) and archived (archive date) mixed, most recent first', () => {
  const all = [th('c1', 'done', { updatedAt: 1 }), th('fin', 'calm', { updatedAt: 6.5, ...done }), th('c2', 'done', { updatedAt: 8 }), th('idea', 'idea'),
    th('a1', 'calm', { updatedAt: 9, archived: { at: 5 } }), th('a2', 'done', { updatedAt: 1, archived: { at: 7 } }),
    th('t', 'calm', { kind: 'topic', archived: { at: 6 } }), th('x', 'done', { space: 'x' }), th('q', 'calm', { updatedAt: 10 })];
  assert.deepEqual(closedOf(all, 's').map(f => f.id), ['c2', 'a2', 'fin', 't', 'a1', 'c1']);
});

test('filter counters: In progress = the space list (no topic, no shelf, archived out), Later = its ideas; other spaces out', () => {
  const all = [th('y', 'you'), th('r', 'run'), th('w', 'wait'), th('q', 'calm'), th('i1', 'idea'), th('i2', 'idea'),
    th('d', 'done'), th('fin', 'calm', done), th('arch', 'run', { archived: { at: 1 } }), th('ai', 'idea', { archived: { at: 1 } }),
    th('top', 'run', { kind: 'topic' }), th('o', 'run', { space: 'x' }), th('oi', 'idea', { space: 'x' })];
  assert.deepEqual(shelfCounts(all, 's'), { work: 4, later: 2 });
  assert.deepEqual(shelfCounts([], 's'), { work: 0, later: 0 });
});
