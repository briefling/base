import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownWrites } from '../src/own.ts';

test('own post: the first upsert after the ack is the user\'s, the next one is not', () => {
  const o = ownWrites();
  o.sent({ type: 'post', client_id: 'c1', space: 'e2e', kind: 'topic' });
  assert.equal(o.own('t1'), false, 'no ack yet');
  o.acked('c1', 't1');
  assert.equal(o.own('t1'), true);
  assert.equal(o.own('t1'), false, 'agent turn / reply after it stays unread');
});

test('answer to an ask counts as an own write too', () => {
  const o = ownWrites();
  o.sent({ type: 'answer', client_id: 'c2', thread: 't2' });
  o.acked('c2', 't2');
  assert.equal(o.own('t2'), true);
});

test('edit of one\'s message counts as an own write too (the thread is upserted after the ack)', () => {
  const o = ownWrites();
  o.sent({ type: 'message.edit', client_id: 'c4', thread: 't4', msg: 'm1', rev: 0, text: 'x' });
  o.acked('c4', 't4');
  assert.equal(o.own('t4'), true);
});

test('acks of other frames (promote, actions) and unknown client ids are ignored', () => {
  const o = ownWrites();
  o.sent({ type: 'action', client_id: 'c3' });
  o.acked('c3', 't3');
  o.acked('someone-else', 't3');
  assert.equal(o.own('t3'), false);
});

test('only the acked thread', () => {
  const o = ownWrites();
  o.sent({ type: 'post', client_id: 'c4' });
  o.acked('c4', 't4');
  assert.equal(o.own('t5'), false);
  assert.equal(o.own('t4'), true);
});

test('reconnection forgets pending writes', () => {
  const o = ownWrites();
  o.sent({ type: 'post', client_id: 'c5' });
  o.sent({ type: 'post', client_id: 'c6' });
  o.acked('c5', 't5');
  o.reset();
  o.acked('c6', 't6');
  assert.equal(o.own('t5'), false);
  assert.equal(o.own('t6'), false);
});
