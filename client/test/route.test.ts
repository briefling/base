import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeOf } from '../src/route.ts';

test('old links: /archived opens Closed, with its conversation', () => {
  assert.deepEqual(parseRoute('#/e2e/archived', ['e2e']), { view: { kind: 'closed', id: 'e2e' }, sel: null });
  assert.deepEqual(parseRoute('#/e2e/archived/t1', ['e2e']), { view: { kind: 'closed', id: 'e2e' }, sel: 't1' });
  assert.equal(routeOf(parseRoute('#/e2e/archived/t1', ['e2e']).view, 't1'), '#/e2e/closed/t1');
});

test('unknown space: Now once the list is known, kept before the hub answers', () => {
  assert.deepEqual(parseRoute('#/gone/t1', ['e2e']), { view: { kind: 'now' }, sel: null });
  assert.deepEqual(parseRoute('#/gone/t1', null), { view: { kind: 'space', id: 'gone' }, sel: 't1' });
});

test('every view reads back from its own route', () => {
  for (const h of ['#/now', '#/new-space', '#/e2e', '#/e2e/t1', '#/e2e/lounge/t2', '#/e2e/later', '#/e2e/closed/t3', '#/e2e/settings', '#/e2e/metrics', '#/e2e/memory', '#/e2e/lineage', '#/e2e/workflow', '#/e2e/overview']) {
    const { view, sel } = parseRoute(h, ['e2e']);
    assert.equal(routeOf(view, sel), h);
  }
});

test('pinned applet: one applet alone, its conversation inside it; the Applets list stays without a selection', () => {
  assert.deepEqual(parseRoute('#/e2e/applets/ap1', ['e2e']), { view: { kind: 'applets', id: 'e2e', pin: 'ap1' }, sel: null });
  assert.deepEqual(parseRoute('#/e2e/applets/ap1/t9', ['e2e']), { view: { kind: 'applets', id: 'e2e', pin: 'ap1' }, sel: 't9' });
  assert.deepEqual(parseRoute('#/e2e/applets', ['e2e']), { view: { kind: 'applets', id: 'e2e' }, sel: null });
  for (const h of ['#/e2e/applets', '#/e2e/applets/ap1', '#/e2e/applets/ap1/t9', '#/e2e/applets/a%20b']) {
    const { view, sel } = parseRoute(h, ['e2e']);
    assert.equal(routeOf(view, sel), h);
  }
});
