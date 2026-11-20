import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paneOf, backBy, cardActions, longPress, LONG_MS, SLOP } from '../src/mobile.ts';

test('paneOf: conversation once something is open, list otherwise, Board/Settings full', () => {
  assert.equal(paneOf(true, null), 'list');
  assert.equal(paneOf(true, 't1'), 'conv');
  assert.equal(paneOf(true, 'new'), 'conv', 'new-topic composer is a conversation');
  assert.equal(paneOf(false, null), 'full');
});

test('backBy: history only when the previous entry is that list', () => {
  assert.equal(backBy({ prev: '#/e2e' }, '#/e2e'), 'history');
  assert.equal(backBy({ prev: '#/now' }, '#/e2e'), 'replace', 'came from elsewhere: do not leave the space');
  assert.equal(backBy(null, '#/e2e'), 'replace', 'refresh or link: no previous entry of ours');
  assert.equal(backBy('x', '#/e2e'), 'replace');
});

test('backBy: history when the previous entry is that space\'s Lounge, feed or topic', () => {
  assert.equal(backBy({ prev: '#/e2e/lounge' }, '#/e2e'), 'history', 'thread opened from a card of the feed');
  assert.equal(backBy({ prev: '#/e2e/lounge/topic-1' }, '#/e2e'), 'history', 'thread opened from a card of a topic');
  assert.equal(backBy({ prev: '#/other/lounge' }, '#/e2e'), 'replace', 'another space\'s Lounge: stay in this space');
  assert.equal(backBy({ prev: '#/e2e/loungex' }, '#/e2e'), 'replace');
  assert.equal(backBy({ prev: '#/e2e2/lounge' }, '#/e2e'), 'replace', 'a space whose id starts like this one');
  assert.equal(backBy({ prev: 42 }, '#/e2e'), 'replace');
});

test('cardActions: pin or unpin, unarchive on archived cards, never archive (thread header only)', () => {
  assert.deepEqual(cardActions({ pinned: false, archived: false }), [{ kind: 'pin' }]);
  assert.deepEqual(cardActions({ pinned: true, archived: false }), [{ kind: 'unpin' }]);
  assert.deepEqual(cardActions({ pinned: false, archived: true }), [{ kind: 'pin' }, { kind: 'unarchive' }]);
});

/** Fake timers: `run()` fires the pending timer as if LONG_MS had elapsed. */
function clock() {
  const pending = new Map<number, () => void>(); let n = 0; const delays: number[] = [];
  return { pending, delays, set: (fn: () => void, ms: number) => { delays.push(ms); pending.set(++n, fn); return n; }, clear: (t: number) => { pending.delete(t); },
    run() { const fns = [...pending.values()]; pending.clear(); fns.forEach(f => f()); } };
}

test('longPress: fires after the hold, then swallows the one click that follows', () => {
  const c = clock(), p = longPress(c); let fired = 0;
  p.touchStart(); p.down(100, 100, () => fired++);
  assert.deepEqual(c.delays, [LONG_MS]);
  assert.equal(p.touching(), true, 'armed: native callout prevented');
  c.run();
  assert.equal(fired, 1);
  assert.equal(p.swallow(), true, 'click after the long press: swallowed');
  assert.equal(p.swallow(), false, 'only once');
});

test('longPress: a short tap, a move or a lift never fires', () => {
  const c = clock(), p = longPress(c); let fired = 0;
  p.touchStart(); p.down(0, 0, () => fired++); p.up(); c.run();
  assert.equal(fired, 0, 'lifted before the hold');
  assert.equal(p.swallow(), false, 'the tap click goes through');
  p.touchStart(); p.down(0, 0, () => fired++); p.move(SLOP - 1, 0); assert.equal(c.pending.size, 1, 'small jitter keeps it armed');
  p.move(SLOP + 1, 0); c.run();
  assert.equal(fired, 0, 'moved (scroll): cancelled');
  assert.equal(p.touching(), false);
});

test('longPress: native signal fires at once, once; next touch forgets a swallowed click', () => {
  const c = clock(), p = longPress(c); let fired = 0;
  p.touchStart(); p.down(0, 0, () => fired++);
  p.fireNow(); c.run(); p.fireNow();
  assert.equal(fired, 1, 'contextmenu then timer: one menu');
  // No click came after the long press (Android): the next tap, e.g. on a menu item, must not be eaten.
  p.touchStart();
  assert.equal(p.swallow(), false);
  p.fireNow(); assert.equal(fired, 1, 'nothing armed: native signal ignored (right click, desktop)');
});
