import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atBottom, convPlan, newAbove, NEAR, keyboardUp, pagePanned, viewportStuck } from '../src/scroll.ts';

test('atBottom: within NEAR px of the end', () => {
  assert.equal(atBottom(500, 1000, 500), true);
  assert.equal(atBottom(500 - NEAR, 1000, 500), true);
  assert.equal(atBottom(500 - NEAR - 1, 1000, 500), false);
  assert.equal(atBottom(0, 300, 500), true, 'no overflow (loading, short thread) = at the bottom');
});

test('convPlan: open, at the bottom, scrolled up', () => {
  assert.equal(convPlan({ opened: true, wasAtBottom: false, grew: true }), 'bottom', 'opening a thread lands on the latest message');
  assert.equal(convPlan({ opened: false, wasAtBottom: true, grew: true }), 'bottom', 'already at the bottom: follow the new message');
  assert.equal(convPlan({ opened: false, wasAtBottom: false, grew: true }), 'pill', 'scrolled up: stay put, show the pill');
  assert.equal(convPlan({ opened: false, wasAtBottom: false, grew: false }), 'keep', 'timestamp tick, status line: nothing moves');
});

test('newAbove: only a new or moved item above the first visible card', () => {
  const before = new Map([['a', '3'], ['b', '2'], ['c', '1']]);
  assert.equal(newAbove(before, [['n', '4'], ['a', '3'], ['b', '2'], ['c', '1']], 'b'), true, 'new item at the top while scrolled');
  assert.equal(newAbove(before, [['c', '5'], ['a', '3'], ['b', '2']], 'b'), true, 'item moved to the top (new activity)');
  assert.equal(newAbove(before, [['n', '4'], ['a', '3'], ['b', '2'], ['c', '1']], null), false, 'at the top: the reader sees it');
  assert.equal(newAbove(before, [['a', '3'], ['b', '2'], ['n', '4'], ['c', '1']], 'b'), false, 'new item below the viewport top');
  assert.equal(newAbove(before, [['a', '3'], ['b', '2'], ['c', '1']], 'b'), false, 'nothing changed (timestamp tick)');
  assert.equal(newAbove(before, [['a', '3'], ['b', '2']], 'gone'), false, 'first visible card left the list');
  assert.equal(newAbove(before, [['b', '9'], ['a', '3']], 'b'), false, 'the first visible card itself moved to the top');
});

test('pagePanned: a leftover iOS pan of the page is undone, a pinch-zoom pan is not', () => {
  assert.equal(pagePanned({ scale: 1, offsetTop: 0, scrollY: 0 }), false, 'page at rest');
  assert.equal(pagePanned({ scale: 1, offsetTop: 312, scrollY: 0 }), true, 'visual viewport panned down (iOS focus)');
  assert.equal(pagePanned({ scale: 1, offsetTop: 0, scrollY: 312 }), true, 'layout viewport scrolled');
  assert.equal(pagePanned({ scale: 1, offsetTop: 0.4, scrollY: 0 }), false, 'sub-pixel rounding');
  assert.equal(pagePanned({ scale: 2, offsetTop: 312, scrollY: 0 }), false, 'zoomed: the reader pans');
});

test('keyboardUp: a field focused and the visible height clearly shrunk', () => {
  assert.equal(keyboardUp({ typing: true, height: 524, tallest: 844 }), true, 'phone keyboard up');
  assert.equal(keyboardUp({ typing: false, height: 524, tallest: 844 }), false, 'no field: a stuck shell, not a keyboard');
  assert.equal(keyboardUp({ typing: true, height: 844, tallest: 844 }), false, 'focus without a virtual keyboard (desktop, hardware keyboard)');
  assert.equal(keyboardUp({ typing: true, height: 760, tallest: 844 }), false, 'a toolbar sliding, not a keyboard');
});

test('viewportStuck: shell left at the keyboard height with no field focused', () => {
  assert.equal(viewportStuck({ typing: false, height: 524, tallest: 844 }), true, 'back in the app, keyboard gone, height still shrunk');
  assert.equal(viewportStuck({ typing: true, height: 524, tallest: 844 }), false, 'typing: the keyboard is really up');
  assert.equal(viewportStuck({ typing: false, height: 844, tallest: 844 }), false, 'full height');
  assert.equal(viewportStuck({ typing: false, height: 841, tallest: 844 }), false, 'a few px off (rounding, home indicator)');
  assert.equal(viewportStuck({ typing: false, height: 839, tallest: 844 }), true, 'more than 4 px off');
  assert.equal(viewportStuck({ typing: false, height: 900, tallest: 844 }), false, 'taller than ever seen');
});
