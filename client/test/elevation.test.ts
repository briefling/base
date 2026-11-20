import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Elevation } from '../../protocol/frames.ts';
import { elevationPageUrl, elevationState } from '../src/elevation.ts';

test('card state: check while the request lives, renew once expired; running until the grant expires; closed', () => {
  const e = (x: Partial<Elevation>): Elevation => ({ agent: 'a', account: '111111111111', minutes: 10, reason: 'r', by: 'a', status: 'open', nonce: 'n', requestExpires: 100, ...x });
  assert.equal(elevationState(e({}), 99), 'check');
  assert.equal(elevationState(e({ error: 'not_approved' }), 99), 'check');
  assert.equal(elevationState(e({}), 100), 'renew');
  assert.equal(elevationState(e({ error: 'expired' }), 0), 'renew', 'the Lambda said expired: renew even if the clock disagrees');
  assert.equal(elevationState(e({ status: 'granted', expiresAt: 200 }), 199), 'running');
  assert.equal(elevationState(e({ status: 'granted', expiresAt: 200 }), 200), 'over');
  for (const status of ['dismissed', 'revoked'] as const) assert.equal(elevationState(e({ status }), 0), 'closed');
});

test('approval page url: https with a path, query/hash dropped; anything else refused', () => {
  assert.equal(elevationPageUrl(' https://d1.cloudfront.net/abc/?x=1#y '), 'https://d1.cloudfront.net/abc/');
  for (const bad of ['', 'nope', 'http://d1.cloudfront.net/abc/', 'https://d1.cloudfront.net/', 'https://d1.cloudfront.net', 'javascript:alert(1)', 'https://u:p@d1.cloudfront.net/abc/'])
    assert.equal(elevationPageUrl(bad), null, bad);
});
