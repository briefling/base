import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreadMark, type Countable } from '../src/unread.ts';

const msg = (id: string, at: number, who = 'ann', extra: Partial<Countable> = {}): Countable =>
  ({ id, at, author: { kind: 'human', id: who }, type: 'text', ...extra });
const thread = [msg('a', 10), msg('b', 20), msg('c', 30, 'me'), msg('d', 40), msg('e', 50)];

test('unreadMark: first message newer than the mark, and the count after it', () => {
  assert.deepEqual(unreadMark(thread, 20, 'me', false), { first: 'd', firstAt: 40, n: 2, more: false }, 'the own message at 30 is not news');
  assert.deepEqual(unreadMark(thread, 10, 'me', false), { first: 'b', firstAt: 20, n: 3, more: false });
});

test('unreadMark: read up to the end (or past it) = no marker', () => {
  assert.deepEqual(unreadMark(thread, 50, 'me', false), { first: null, firstAt: null, n: 0, more: false });
  assert.deepEqual(unreadMark(thread, 99, 'me', true), { first: null, firstAt: null, n: 0, more: false });
  assert.equal(unreadMark([], 5, 'me', true).first, null);
});

test('unreadMark: only the reader\'s own messages after the mark = nothing new', () => {
  assert.equal(unreadMark([msg('a', 10), msg('b', 20, 'me')], 10, 'me', false).first, null);
});

test('unreadMark: never read = every message of the others counts', () => {
  assert.deepEqual(unreadMark(thread, undefined, 'me', false), { first: 'a', firstAt: 10, n: 4, more: false });
  assert.deepEqual(unreadMark(thread, undefined, 'me', true), { first: 'a', firstAt: 10, n: 4, more: true }, 'older pages may hold more');
});

test('unreadMark: the first unread may be older than the loaded page', () => {
  assert.equal(unreadMark(thread, 5, 'me', true).more, true, 'oldest loaded already unread, pages remain');
  assert.equal(unreadMark(thread, 5, 'me', false).more, false, 'start of the thread loaded: the count is exact');
  assert.equal(unreadMark(thread, 10, 'me', true).more, false, 'the read message is loaded: the marker is in the page');
});

test('unreadMark: notices and answers are neither counted nor the marker', () => {
  const ms = [msg('a', 10), msg('n', 20, 'gw', { notice: true }), msg('q', 30, 'bob', { type: 'answer' }), msg('d', 40)];
  assert.deepEqual(unreadMark(ms, 10, 'me', false), { first: 'd', firstAt: 40, n: 1, more: false });
});
