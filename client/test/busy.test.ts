import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyCounts } from '../src/busy.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const thread = (o: Partial<PublicThread> = {}): PublicThread => ({
  id: 'f1', space: 'briefling', title: 'Deploy', owner: 'milan', kind: 'thread', state: 'run', version: 1, updatedAt: 1, ...o,
} as PublicThread);

test('counts the running threads of the space only', () => {
  const all = [thread({ id: 'a' }), thread({ id: 'b' }), thread({ id: 'c', space: 'manta' }), thread({ id: 'd', state: 'you' })];
  assert.deepEqual(busyCounts(all, 'briefling'), { threads: 2, topics: 0 });
  assert.deepEqual(busyCounts(all, 'manta'), { threads: 1, topics: 0 });
});

test('nothing running: 0 and 0 (no dot)', () => {
  assert.deepEqual(busyCounts([thread({ state: 'calm' }), thread({ state: 'wait' }), thread({ state: 'done' })], 'briefling'), { threads: 0, topics: 0 });
  assert.deepEqual(busyCounts([], 'briefling'), { threads: 0, topics: 0 });
});

test('topics count apart, from `working` (not from state)', () => {
  const all = [
    thread({ id: 'a', kind: 'topic', state: 'calm', working: ['milan'] }),
    thread({ id: 'b', kind: 'topic', state: 'run', working: ['milan', 'gaston'] }),
    thread({ id: 'c', kind: 'topic', state: 'run' }), // no agent listed: nothing at work
    thread({ id: 'd', kind: 'topic', working: [] }),
    thread({ id: 'e' }),
  ];
  assert.deepEqual(busyCounts(all, 'briefling'), { threads: 1, topics: 2 });
});

test('archived conversations and the hidden memory review topic are left out', () => {
  const all = [thread({ id: 'a', archived: { by: 'u', at: 1 } } as Partial<PublicThread>),
    thread({ id: 'b', kind: 'topic', working: ['milan'], archived: { by: 'u', at: 1 } } as Partial<PublicThread>),
    thread({ id: 'c', kind: 'topic', working: ['milan'], memoryReview: true })];
  assert.deepEqual(busyCounts(all, 'briefling'), { threads: 0, topics: 0 });
});
