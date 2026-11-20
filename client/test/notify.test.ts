import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertKind, becameYours, isYours, lastAnswer, tabTitle } from '../src/notify.ts';
import type { PublicThread } from '../../protocol/frames.ts';

const thread = (o: Partial<PublicThread> = {}): PublicThread => ({
  id: 'f1', space: 'civic', title: 'Deploy v2', owner: 'milan', kind: 'thread', state: 'run', version: 3, updatedAt: 1, ...o,
} as PublicThread);

test('switch to Your turn: one notification', () => {
  assert.equal(becameYours(thread({ state: 'run' }), thread({ state: 'you', version: 4 })), true);
  assert.equal(becameYours(thread({ state: 'calm' }), thread({ state: 'you', version: 4 })), true);
});

test('already Your turn at load, or already Your turn before: nothing', () => {
  assert.equal(becameYours(undefined, thread({ state: 'you' })), false); // first synced
  assert.equal(becameYours(thread({ state: 'you' }), thread({ state: 'you', version: 4 })), false); // new version, same state
});

test('late or replayed frame (version not newer): nothing', () => {
  assert.equal(becameYours(thread({ state: 'run', version: 5 }), thread({ state: 'you', version: 4 })), false);
  assert.equal(becameYours(thread({ state: 'run', version: 4 }), thread({ state: 'you', version: 4 })), false);
});

test('Lounge topic and archived thread are never signalled', () => {
  assert.equal(becameYours(thread({ kind: 'topic' }), thread({ kind: 'topic', state: 'you', version: 4 })), false);
  assert.equal(becameYours(thread(), thread({ state: 'you', version: 4, archived: { by: 'blair', at: 1 } } as Partial<PublicThread>)), false);
  assert.equal(isYours(thread({ state: 'you', archived: { by: 'blair', at: 1 } } as Partial<PublicThread>)), false);
});

test('unarchived and Your turn: signalled (it shows up again in Now)', () => {
  assert.equal(becameYours(thread({ state: 'you', archived: { by: 'blair', at: 1 } } as Partial<PublicThread>), thread({ state: 'you', version: 4 })), true);
});

test('tab title', () => {
  assert.equal(tabTitle(0), 'briefling');
  assert.equal(tabTitle(2), '(2) briefling');
});

test('alert: in the background notification + pop; in front of the app pop only, nothing on the open thread', () => {
  assert.equal(alertKind(true, false), 'both');
  assert.equal(alertKind(true, true), 'both');   // thread open but window unfocused: not in view
  assert.equal(alertKind(false, false), 'pop');
  assert.equal(alertKind(false, true), 'none');
});

test('lastAnswer: the agent\'s latest text or question (what a Your turn alert jumps to), never a human\'s nor a system line', () => {
  const m = (id: string, kind: 'agent' | 'human' | 'system', at: number, type = 'text') => ({ id, thread: 't', author: { kind, id: kind === 'agent' ? 'mini' : 'b' }, text: 'x', at, type }) as any;
  assert.equal(lastAnswer([]), null);
  assert.equal(lastAnswer([m('h1', 'human', 1)]), null);
  assert.equal(lastAnswer([m('a1', 'agent', 1), m('a2', 'agent', 3, 'ask'), m('h1', 'human', 4), m('s1', 'system', 5), m('a0', 'agent', 2)]), 'a2');
  assert.equal(lastAnswer([m('a1', 'agent', 1), m('t1', 'agent', 9, 'tool')]), 'a1', 'a tool line is not an answer');
});
