import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertVersioned, lockKey, resourceKey, normalizeLock, posIn, parkedOn, heldWithQueue, keepsPlace, placeOf, waitOrder } from '../src/locks.ts';
import type { AgentLock, ResourceLock } from '../../protocol/frames.ts';

const res = (resource: string, holder: string | null, queue: string[], version = 1, space = 'briefling'): ResourceLock =>
  ({ space, resource, holder, agent: holder ? 'milan' : null, queue, since: 0, version });

test('the highest version wins, whatever the arrival order', () => {
  const m = new Map<string, ResourceLock>();
  const a = res('emulator', 't1', [], 2), b = res('emulator', 't2', [], 1), c = res('emulator', null, [], 3);
  assert.equal(upsertVersioned(m, resourceKey(a), a), true);
  assert.equal(upsertVersioned(m, resourceKey(b), b), false);
  assert.equal(m.get('briefling|emulator')!.holder, 't1');
  assert.equal(upsertVersioned(m, resourceKey(a), a), false); // same version again: unchanged
  assert.equal(upsertVersioned(m, resourceKey(c), c), true);
  assert.equal(m.get('briefling|emulator')!.holder, null);
  assert.equal(lockKey({ space: 's', agent: 'milan' }), 's|milan');
});

test('a lock from an older hub (holder) reads as a holders list', () => {
  const old = { space: 's', agent: 'milan', holder: 't1', queue: ['t2'], since: 0, version: 4 } as unknown as AgentLock;
  assert.deepEqual(normalizeLock(old).holders, ['t1']);
  assert.deepEqual(normalizeLock({ ...old, holder: null } as unknown as AgentLock).holders, []);
  const cur: AgentLock = { space: 's', agent: 'milan', holders: ['t1', 't3'], queue: [], since: 0, version: 5 };
  assert.equal(normalizeLock(cur), cur);
});

test('queue position: 1 = the next one, null when not queued', () => {
  assert.equal(posIn(['a', 'b'], 'b'), 2);
  assert.equal(posIn(['a', 'b'], 'c'), null);
  assert.equal(posIn(undefined, 'a'), null);
});

test('parked thread: found through the resource whose queue holds it, same space only, never a topic', () => {
  const rs = [res('emulator', 't9', ['t1']), res('stack:briefling-dev', 't1', ['t2', 't3']), res('gateway', 'x', ['t3'], 1, 'other')];
  const p = parkedOn(rs, { id: 't3', space: 'briefling', kind: 'thread' });
  assert.deepEqual([p?.lock.resource, p?.pos, p?.lock.holder], ['stack:briefling-dev', 2, 't1']);
  assert.equal(parkedOn(rs, { id: 't4', space: 'briefling', kind: 'thread' }), null);
  assert.equal(parkedOn(rs, { id: 't3', space: 'nope', kind: 'thread' }), null);
  assert.equal(parkedOn(rs, { id: 't3', space: 'briefling', kind: 'topic' }), null);
});

test('place: parked on a resource first, else in the agent queue, never a topic', () => {
  const l: AgentLock = { space: 'briefling', agent: 'milan', holders: ['t0'], queue: ['t1', 't2'], since: 0, version: 1 };
  const rs = [res('emulator', 't0', ['t2'])];
  assert.deepEqual(placeOf(l, rs, { id: 't1', space: 'briefling', kind: 'thread' }), { on: 'agent', name: 'milan', pos: 1 });
  assert.deepEqual(placeOf(l, rs, { id: 't2', space: 'briefling', kind: 'thread' }), { on: 'resource', name: 'emulator', pos: 1 });
  assert.equal(placeOf(l, rs, { id: 't0', space: 'briefling', kind: 'thread' }), null);
  assert.equal(placeOf(null, [], { id: 't1', space: 'briefling', kind: 'thread' }), null);
  assert.equal(placeOf(l, rs, { id: 't1', space: 'briefling', kind: 'topic' }), null);
});

test('Waiting order: queued threads in order of passage (the next on top), then the others by activity', () => {
  // Blair's case: the queue is 1. slots, 2. metrics, 3. badges, but the latest activity put them upside down.
  const l: AgentLock = { space: 'briefling', agent: 'milan', holders: ['h'], queue: ['slots', 'metrics', 'badges'], since: 0, version: 1 };
  const rs = [res('emulator', 'h', ['deploy'])];
  const th = (id: string, updatedAt: number) => ({ id, space: 'briefling', kind: 'thread' as const, updatedAt });
  const fs = [th('gap', 60), th('other', 10), th('badges', 50), th('metrics', 40), th('slots', 20), th('deploy', 30)];
  const order = waitOrder(fs, f => placeOf(l, rs, f)).map(f => f.id);
  assert.deepEqual(order, ['slots', 'deploy', 'metrics', 'badges', 'gap', 'other']);
  assert.deepEqual(fs.map(f => f.id), ['gap', 'other', 'badges', 'metrics', 'slots', 'deploy'], 'input left untouched');
  assert.deepEqual(waitOrder(fs, () => null).map(f => f.id), ['gap', 'badges', 'metrics', 'deploy', 'slots', 'other']);
});

test('held resources shown only when other threads wait for them', () => {
  const rs = [res('stack:x', 't1', ['t2']), res('emulator', 't1', ['t3', 't4']), res('gateway', 't1', []), res('stack:y', 't1', ['t5'], 1, 'other')];
  assert.deepEqual(heldWithQueue(rs, { id: 't1', space: 'briefling' }).map(r => r.resource), ['emulator', 'stack:x']);
  assert.deepEqual(heldWithQueue(rs, { id: 't2', space: 'briefling' }), []);
});

test('a holder thread not mid-turn keeps a place; a running, queued or topic one does not', () => {
  const l: AgentLock = { space: 's', agent: 'milan', holders: ['t1', 't2'], queue: ['t3'], since: 0, version: 1 };
  assert.equal(keepsPlace(l, { id: 't1', kind: 'thread', state: 'calm' }), true);
  assert.equal(keepsPlace(l, { id: 't1', kind: 'thread', state: 'you' }), true);
  assert.equal(keepsPlace(l, { id: 't2', kind: 'thread', state: 'run' }), false);
  assert.equal(keepsPlace(l, { id: 't3', kind: 'thread', state: 'calm' }), false);
  assert.equal(keepsPlace(l, { id: 't1', kind: 'topic', state: 'calm' }), false);
  assert.equal(keepsPlace(null, { id: 't1', kind: 'thread', state: 'calm' }), false);
});
