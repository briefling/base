import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertedKind, litKind, capBursts, vtDir, BURST } from '../src/motion.ts';

test('inserted: messages and cards arrive, badges and pills pop, anything else stays still', () => {
  assert.equal(insertedKind('m:m1', 'div', 'msgs'), 'arrive');
  assert.equal(insertedKind('c:t1', 'div', 'feed-msgs'), 'arrive');
  assert.equal(insertedKind(null, 'b', 'nav on'), 'pop');
  assert.equal(insertedKind(null, 'b', 'btn ic mob menu-btn'), 'pop');
  assert.equal(insertedKind('pill:down', 'div', 'conv'), 'pop');
  assert.equal(insertedKind('fab:unread', 'div', 'list'), 'pop');
  assert.equal(insertedKind(null, 'b', 'aw-t'), null);        // bold text in a banner is not a badge
  assert.equal(insertedKind(null, 'b', 'navigation'), null);  // class token, not a substring
  assert.equal(insertedKind('h:t1:m1', 'div', 'pal-list'), null);
  assert.equal(insertedKind(null, 'div', 'msgs'), null);
});

test('lit: a badge leaving zero pops, a Lounge row turning unread pops its dot', () => {
  assert.equal(litKind('b', 'zero', ''), 'pop');
  assert.equal(litKind('b', '', 'zero'), null);
  assert.equal(litKind('b', 'calm', 'calm'), null);
  assert.equal(litKind('div', 'thread topic', 'thread topic unread'), 'pop-dot');
  assert.equal(litKind('div', 'thread topic unread', 'thread topic unread sel'), null); // already unread
  assert.equal(litKind('div', 'thread', 'thread unread'), null);                         // chantier row: no dot
});

test('bursts: more than BURST of a kind in one patch is a refresh, nothing of that kind moves', () => {
  const xs = (k: 'arrive' | 'pop', n: number) => Array.from({ length: n }, (_, i) => ({ kind: k, i }));
  assert.equal(capBursts(xs('arrive', BURST)).length, BURST);
  assert.deepEqual(capBursts([...xs('arrive', BURST + 1), ...xs('pop', 1)]).map(x => x.kind), ['pop']);
  assert.deepEqual(capBursts([]), []);
});

test('view transition: none on the first render or the same screen, slide by depth, fade otherwise', () => {
  const s = (key: string, depth = 0) => ({ key, depth });
  assert.equal(vtDir(null, s('#/e2e')), null);
  assert.equal(vtDir(s('#/e2e'), s('#/e2e')), null);
  assert.equal(vtDir(s('#/e2e/lounge'), s('#/e2e/t1', 1)), 'fwd');
  assert.equal(vtDir(s('#/e2e/t1', 1), s('#/e2e/lounge')), 'back');
  assert.equal(vtDir(s('#/e2e/t1', 1), s('#/e2e/t2', 1)), 'fade');
  assert.equal(vtDir(s('#/e2e'), s('#/now')), 'fade');
});
