import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onHistory, nextOlder, claimOlder, hasOlder, olderFailed, type Older } from '../src/older.ts';
import { convPlan } from '../src/scroll.ts';

test('older: the latest page with more → the sentinel asks the page before its first message, once at a time', () => {
  const o: Older = new Map();
  assert.equal(hasOlder(o, 't'), false, 'nothing known before the history');
  onHistory(o, 't', { more: true, first: 'm100' });
  assert.equal(hasOlder(o, 't'), true);
  assert.equal(nextOlder(o, 't'), 'm100');
  assert.equal(nextOlder(o, 't'), null, 'a request in flight is not sent twice');
  onHistory(o, 't', { before: 'm100', more: true, first: 'm50' });
  assert.equal(nextOlder(o, 't'), 'm50');
  onHistory(o, 't', { before: 'm50', more: false, first: 'm1' });
  assert.equal(hasOlder(o, 't'), false, 'start of the conversation reached');
  assert.equal(nextOlder(o, 't'), null);
});

test('older: short conversation (no more) shows no sentinel; a stale page is ignored; a lost request may be asked again', () => {
  const o: Older = new Map();
  onHistory(o, 'short', { more: false, first: 'a' });
  assert.equal(hasOlder(o, 'short'), false);
  onHistory(o, 't', { more: true, first: 'm100' });
  assert.equal(nextOlder(o, 't'), 'm100');
  onHistory(o, 't', { before: 'zzz', more: true, first: 'm1' });
  assert.equal(o.get('t')!.oldest, 'm100', 'a page for another start does not move it');
  assert.equal(nextOlder(o, 't'), 'm100', 'and frees the request');
  olderFailed(o);
  assert.equal(nextOlder(o, 't'), 'm100', 'after a lost connection, asked again');
});

test('scroll: an older page prepended keeps the reader\'s place (anchor), never the « new messages » pill nor a jump to the bottom', () => {
  assert.equal(convPlan({ opened: false, wasAtBottom: false, grew: true, older: true }), 'anchor');
  assert.equal(convPlan({ opened: false, wasAtBottom: false, grew: true }), 'pill');
  assert.equal(convPlan({ opened: true, wasAtBottom: false, grew: true }), 'bottom');
});

test('older: a search jump and the top sentinel never ask the same page twice, whichever comes first', () => {
  const o: Older = new Map();
  onHistory(o, 't', { more: true, first: 'm60' });
  assert.equal(nextOlder(o, 't'), 'm60', 'the sentinel asks first');
  assert.equal(claimOlder(o, 't', 'm60'), false, 'the jump waits for that answer');
  onHistory(o, 't', { before: 'm60', more: false, first: 'm1' });
  const p: Older = new Map();
  onHistory(p, 't', { more: true, first: 'm60' });
  assert.equal(claimOlder(p, 't', 'm60'), true, 'the jump asks first');
  assert.equal(nextOlder(p, 't'), null, 'the sentinel waits for that answer');
  assert.equal(claimOlder(p, 't', 'zzz'), true, 'a page the sentinel does not know is the jump\'s alone');
});
