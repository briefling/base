import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followView } from '../src/shelves.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const th = (id: string, state: string, extra: Record<string, unknown> = {}) =>
  ({ id, space: 's', kind: 'thread', state, updatedAt: 0, ...extra }) as unknown as PublicThread;
const closed = { kind: 'closed', id: 's' }, later = { kind: 'later', id: 's' };

test('follow: my message takes the open conversation off its shelf, the view goes home with it', () => {
  // archived topic reopened by my post: Lounge; closed or Later thread: the space list
  assert.deepEqual(followView(closed, 'a', 'a', th('a', 'calm', { kind: 'topic' })), { kind: 'lounge', id: 's' });
  assert.deepEqual(followView(closed, 'a', 'a', th('a', 'you')), { kind: 'space', id: 's' });
  assert.deepEqual(followView(later, 'a', 'a', th('a', 'run')), { kind: 'space', id: 's' });
  // from Later to Closed (still shelved, but elsewhere): the other shelf
  assert.deepEqual(followView(later, 'a', 'a', th('a', 'idea', { archived: { at: 1 } })), { kind: 'closed', id: 's' });
});

test('follow: stay put otherwise', () => {
  // still on the shelf shown (the hub update has not landed yet, or a thread.seen bump)
  assert.equal(followView(closed, 'a', 'a', th('a', 'done')), null);
  assert.equal(followView(closed, 'a', 'a', th('a', 'calm', { kind: 'topic', archived: { at: 1 } })), null);
  assert.equal(followView(later, 'a', 'a', th('a', 'idea')), null);
  // someone else reopened it: no message of mine, the view does not move
  assert.equal(followView(closed, 'a', null, th('a', 'you')), null);
  assert.equal(followView(closed, 'a', 'b', th('a', 'you')), null);
  // not the open conversation, or another space's shelf, or not a shelf view
  assert.equal(followView(closed, 'b', 'a', th('a', 'you')), null);
  assert.equal(followView({ kind: 'closed', id: 'x' }, 'a', 'a', th('a', 'you')), null);
  assert.equal(followView({ kind: 'space', id: 's' }, 'a', 'a', th('a', 'you')), null);
  assert.equal(followView({ kind: 'now' }, 'a', 'a', th('a', 'you')), null);
});
