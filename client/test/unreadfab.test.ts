import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreadFab, fabDir, type FabTopic } from '../src/unreadfab.ts';
import type { UnreadMark } from '../src/unread.ts';

const mark = (n: number, firstAt: number | null, more = false): UnreadMark => ({ first: n ? 'm' : null, firstAt: n ? firstAt : null, n, more });
const topic = (id: string, at: number, unread = true): FabTopic => ({ id, at, unread });
const none = new Set<string>();

test('unreadFab: nothing unread = no pill', () => {
  assert.equal(unreadFab(null, false, [], none), null);
  assert.equal(unreadFab(mark(0, null), false, [topic('a', 10, false)], none), null);
});

test('unreadFab: counts the Bar messages and the unread topic cards only', () => {
  assert.deepEqual(unreadFab(mark(3, 50), false, [topic('a', 10), topic('b', 20, false), topic('c', 60)], none),
    { msgs: 3, more: false, topics: 2, next: { kind: 'topic', id: 'a' } });
});

test('unreadFab: next = the oldest target, the messages line taken as one', () => {
  assert.deepEqual(unreadFab(mark(3, 5), false, [topic('a', 10)], none)?.next, { kind: 'msgs' });
  assert.deepEqual(unreadFab(mark(3, 50), false, [topic('c', 60), topic('a', 10)], none)?.next, { kind: 'topic', id: 'a' });
  assert.deepEqual(unreadFab(mark(3, 10), false, [topic('a', 10)], none)?.next, { kind: 'msgs' }, 'same time: the line comes first');
});

test('unreadFab: a first unread older than the loaded page comes first, « n+ »', () => {
  assert.deepEqual(unreadFab(mark(100, 500, true), false, [topic('a', 10)], none), { msgs: 100, more: true, topics: 1, next: { kind: 'msgs' } });
});

test('unreadFab: each target reached is dropped from the count, down to no pill', () => {
  const topics = [topic('a', 10), topic('c', 60)];
  const done = new Set<string>();
  let f = unreadFab(mark(2, 30), false, topics, done);
  assert.deepEqual([f?.msgs, f?.topics, f?.next], [2, 2, { kind: 'topic', id: 'a' }]);
  done.add('a'); f = unreadFab(mark(2, 30), false, topics, done);
  assert.deepEqual([f?.msgs, f?.topics, f?.next], [2, 1, { kind: 'msgs' }]);
  f = unreadFab(mark(2, 30), true, topics, done);
  assert.deepEqual([f?.msgs, f?.topics, f?.next], [0, 1, { kind: 'topic', id: 'c' }]);
  done.add('c');
  assert.equal(unreadFab(mark(2, 30), true, topics, done), null);
});

test('unreadFab: a topic read meanwhile (opened) no longer counts', () => {
  assert.equal(unreadFab(null, false, [topic('a', 10, false)], none), null);
});

test('fabDir: the arrow follows where the next target is, not a fixed ↓', () => {
  const view = { top: 100 };
  assert.equal(fabDir({ top: -400 }, view), 'up', 'above the screen (the feed opens at the bottom, oldest target first)');
  assert.equal(fabDir({ top: 90 }, view), 'up', 'cut by the top edge');
  assert.equal(fabDir({ top: 900 }, view), 'down', 'below the screen');
  assert.equal(fabDir({ top: 100 }, view), 'down', 'on screen: a tap brings it to the top, so down');
  assert.equal(fabDir(null, view), 'up', 'not rendered yet = older than the loaded page');
});
