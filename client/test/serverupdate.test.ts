import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorKey, pillOf, type ServerUpdate } from '../src/serverupdate.ts';

const base: ServerUpdate = { current: '0.1.0', mode: 'service', check: true, status: 'idle' };

test('pill: a new version, dismissed per version; the update running; a rolled back update', () => {
  assert.equal(pillOf(null, null), null);
  assert.equal(pillOf(base, null), null);
  assert.deepEqual(pillOf({ ...base, latest: '0.2.0' }, null), { kind: 'new', key: 'new:0.2.0', version: '0.2.0' });
  assert.equal(pillOf({ ...base, latest: '0.2.0' }, 'new:0.2.0'), null);
  assert.deepEqual(pillOf({ ...base, latest: '0.3.0' }, 'new:0.2.0')?.version, '0.3.0', 'a later version shows again');
  assert.equal(pillOf({ ...base, latest: '0.2.0', status: 'waiting' }, 'new:0.2.0')?.kind, 'busy', 'never hidden while it runs');
  const rb: ServerUpdate = { ...base, last: { from: '0.1.0', to: '0.2.0', state: 'rolled_back', at: 5 } };
  assert.deepEqual(pillOf(rb, null), { kind: 'rolled_back', key: 'rb:0.2.0:5', version: '0.2.0' });
  assert.equal(pillOf(rb, 'rb:0.2.0:5'), null);
  assert.equal(pillOf({ ...base, last: { from: '0.1.0', to: '0.2.0', state: 'ok', at: 5 } }, null), null);
});

test('failure codes to text', () => {
  assert.equal(errorKey('integrity'), 'su_err_integrity');
  for (const c of ['preflight', 'not_the_release', 'incomplete']) assert.equal(errorKey(c), 'su_err_package');
  assert.equal(errorKey('swap'), 'su_err_swap');
  assert.equal(errorKey('registry_500'), 'su_err_download');
  assert.equal(errorKey(undefined), 'su_err_download');
});
