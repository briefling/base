import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMute, mutedSet, mutesOf } from '../src/mute.ts';

test('mutes: the connect list is the base, a more recent mute wins, an older echo is ignored', () => {
  const m = mutesOf([{ id: 'a', name: 'A', muted: true }, { id: 'b', name: 'B' }]);
  assert.deepEqual([...mutedSet(m)], ['a']);
  applyMute(m, { space: 'b', on: true, at: 10 });
  applyMute(m, { space: 'b', on: false, at: 9 }); // late echo of an older toggle
  applyMute(m, { space: 'a', on: false, at: 11 });
  assert.deepEqual([...mutedSet(m)], ['b']);
});
