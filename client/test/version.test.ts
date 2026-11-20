import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewBuild, servedBuild } from '../src/version.ts';

test('servedBuild: the id of a well-formed version.json, null otherwise', () => {
  assert.equal(servedBuild({ build: 'a1b2c3d4e5f6' }), 'a1b2c3d4e5f6');
  for (const bad of [null, undefined, 'a1b2c3d4e5f6', {}, { build: 42 }, { build: '' }, { build: 'abc' }, { build: '<script>' }, { build: 'A1B2C3D4E5F6' }])
    assert.equal(servedBuild(bad), null, JSON.stringify(bad));
});

test('isNewBuild: only a valid served id that differs from the running one', () => {
  assert.equal(isNewBuild('a1b2c3d4e5f6', { build: 'a1b2c3d4e5f6' }), false); // same front
  assert.equal(isNewBuild('a1b2c3d4e5f6', { build: 'ffffff000000' }), true); // a deploy changed it
  assert.equal(isNewBuild('a1b2c3d4e5f6', null), false); // no file (local dev, 404 body)
  assert.equal(isNewBuild('a1b2c3d4e5f6', { build: 'oops' }), false); // malformed
  // A bundle built without the build script (placeholder left) never claims a new version.
  assert.equal(isNewBuild('__briefling_build_id__', { build: 'ffffff000000' }), false);
});
