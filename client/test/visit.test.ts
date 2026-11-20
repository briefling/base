import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VISIT_RETRIES, VISIT_RETRY_MS, visitOutcome, visitRetry, visitText } from '../preview/visitlogic.ts';
import { VISITOR_MIN_DEFAULT, visitorLive, visitorMinutes, visitorOk, visitorToken, visitorTokenOfHash } from '../../protocol/preview.ts';
import type { VisitEntry } from '../preview/visit.ts';
import type { ViewerEntry } from '../preview/viewer.ts';

const SECRET = 'A'.repeat(43);
const _types: [VisitEntry, ViewerEntry] = [true, true];

test('visitor token: <msg>.<secret> only, read from the hash', () => {
  assert.deepEqual(visitorToken(`m1.${SECRET}`), { msg: 'm1', secret: SECRET });
  for (const bad of [SECRET, `m1.${SECRET}x`, `m1.${SECRET.slice(1)}`, `m.1.${SECRET}`, `.${SECRET}`, `m1.${'+'.repeat(43)}`, 42, null])
    assert.equal(visitorToken(bad), null, String(bad));
  assert.equal(visitorTokenOfHash(`#t=m1.${SECRET}`), `m1.${SECRET}`);
  assert.equal(visitorTokenOfHash(`#x=1&t=m1.${SECRET}`), `m1.${SECRET}`);
  assert.equal(visitorTokenOfHash(`#t=m1.short`), null);
  assert.equal(visitorTokenOfHash(''), null);
});

test('visitor link: lifetime bounds, which lines, live until the deadline', () => {
  assert.equal(visitorMinutes(undefined), VISITOR_MIN_DEFAULT);
  assert.equal(visitorMinutes(60), 60);
  for (const bad of [0, 4, 121, 30.5, '30', null]) assert.equal(visitorMinutes(bad), null, String(bad));
  assert.equal(visitorOk({ agent: 'a', device: 'emulator-5554', label: 'x', status: 'on' }), true);
  assert.equal(visitorOk({ agent: 'a', port: 5173, label: 'x', status: 'on' }), true);
  assert.equal(visitorOk({ agent: 'a', voice: true, label: 'x', status: 'on' }), false, 'no voice');
  assert.equal(visitorOk({ agent: 'a', port: 5173, label: 'x', status: 'off' }), false);
  const p = { agent: 'a', port: 5173, label: 'x', status: 'on' as const, visitor: { until: 1000, by: 'b' } };
  assert.deepEqual(visitorLive(p, 999), { until: 1000, by: 'b' });
  assert.equal(visitorLive(p, 1000), null);
});

test('visitor page: a cut comes back by itself within the budget, a dead link never', () => {
  assert.equal(visitOutcome('closed'), 'retry');
  assert.equal(visitOutcome('socket'), 'retry');
  assert.equal(visitOutcome('expired'), 'expired');
  assert.equal(visitOutcome('replaced'), 'elsewhere', 'opened elsewhere: no ping-pong between two devices');
  assert.equal(visitOutcome('not_shared'), 'stopped');
  assert.equal(visitOutcome('forbidden'), 'error');
  const now = 1_000_000;
  assert.equal(visitRetry([], now, now + 1), true);
  assert.equal(visitRetry([], now, now), false, 'never past the deadline');
  const recent = Array.from({ length: VISIT_RETRIES }, (_, i) => now - i * 1000);
  assert.equal(visitRetry(recent, now, null), false);
  assert.equal(visitRetry(recent.map(t => t - VISIT_RETRY_MS), now, null), true, 'old retries do not count');
  assert.match(visitText('until', 'fr-FR', { t: '10:42' }), /jusqu’à 10:42/);
  assert.match(visitText('expired', 'en-US'), /expired/);
});
