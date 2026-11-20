import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_STALE_MS, browserFrameOk, keepFrame, shownFrame } from '../../protocol/browser.ts';

test('browserFrameOk: capture or end, bounded base64', () => {
  assert.ok(browserFrameOk({ at: 1, jpeg: 'QUJD' }));
  assert.ok(browserFrameOk({ at: 1, end: true }));
  assert.ok(!browserFrameOk({ at: 1, end: true, jpeg: 'QUJD' }));
  assert.ok(!browserFrameOk({ at: 0, jpeg: 'QUJD' }));
  assert.ok(!browserFrameOk({ at: 1, jpeg: 'QUJ' }));
  assert.ok(!browserFrameOk({ at: 1, jpeg: 'QUJD', w: 0 }));
  assert.ok(!browserFrameOk({ at: 1, jpeg: '"><x' }));
});

test('keepFrame: the most recent by at wins, a newer end clears', () => {
  const a = { thread: 't', agent: 'm', at: 5, jpeg: 'QUJD' }, old = { ...a, at: 3 }, end = { thread: 't', agent: 'm', at: 6, end: true as const };
  assert.equal(keepFrame(undefined, a), a);
  assert.equal(keepFrame(a, old), a, 'late frame ignored');
  assert.equal(keepFrame(a, end), null);
  assert.equal(keepFrame(a, { ...end, at: 4 }), a, 'older end ignored');
});

test('shownFrame: stale or no turn hides it', () => {
  const a = { thread: 't', agent: 'm', at: 5, jpeg: 'QUJD' };
  assert.equal(shownFrame(a, 0, 1000, true), a);
  assert.equal(shownFrame(a, 0, BROWSER_STALE_MS, true), null);
  assert.equal(shownFrame(a, 0, 1000, false), null);
});
