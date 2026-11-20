import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteUndelivered, agentActive, noticeAfter, type UndeliveredMap } from '../src/undelivered.ts';

test('undelivered: shown under its message, at the end when the message is not loaded, one per thread (latest wins)', () => {
  const m: UndeliveredMap = new Map();
  assert.equal(noticeAfter(m, 't1', ['a']), null);
  noteUndelivered(m, { thread: 't1', message: 'a', agent: 'milan' });
  assert.deepEqual(noticeAfter(m, 't1', ['a', 'b']), { agent: 'milan', after: 'a' });
  assert.deepEqual(noticeAfter(m, 't1', ['b']), { agent: 'milan', after: null });
  noteUndelivered(m, { thread: 't1', message: 'b', agent: 'milan' });
  assert.deepEqual(noticeAfter(m, 't1', ['a', 'b']), { agent: 'milan', after: 'b' });
  assert.equal(noticeAfter(m, 't2', ['a']), null);
});

test('undelivered: cleared once the agent runs a turn or posts in the thread, not by a human message', () => {
  const m: UndeliveredMap = new Map();
  noteUndelivered(m, { thread: 't1', message: 'a', agent: 'milan' });
  agentActive(m, 't1', { author: { kind: 'human' } });
  agentActive(m, 't1', { state: 'calm' });
  assert.ok(m.has('t1'));
  agentActive(m, 't1', { state: 'run' });
  assert.ok(!m.has('t1'));
  noteUndelivered(m, { thread: 't1', message: 'a', agent: 'milan' });
  agentActive(m, 't1', { author: { kind: 'agent' } });
  assert.ok(!m.has('t1'));
});
