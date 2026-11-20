import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBoot, onSubscribed, onSynced, splash, unloaded, nextCheck, MIN_SHOW, TIMEOUT } from '../src/boot.ts';

const T0 = 1_000_000;

test('waits for subscribed, then for every space synced', () => {
  const b = newBoot(T0);
  assert.equal(splash(b, [], T0 + 100).kind, 'wait');
  onSubscribed(b, ['a', 'b'], T0 + 200);
  assert.equal(splash(b, ['a', 'b'], T0 + 2000).kind, 'wait');
  onSynced(b, 'a');
  assert.equal(splash(b, ['a', 'b'], T0 + 2000).kind, 'wait', 'b still loading');
  onSynced(b, 'b');
  assert.equal(splash(b, ['a', 'b'], T0 + 2000).kind, 'leave');
});

test('shown at least MIN_SHOW ms even when everything answers at once', () => {
  assert.equal(MIN_SHOW, 1500, 'Blair: 600 ms was too short');
  const b = newBoot(T0);
  onSubscribed(b, ['a'], T0 + 50); onSynced(b, 'a');
  assert.equal(splash(b, ['a'], T0 + 100).kind, 'wait');
  assert.equal(nextCheck(b, ['a'], T0 + 100), MIN_SHOW - 100);
  assert.equal(splash(b, ['a'], T0 + MIN_SHOW).kind, 'leave');
});

test('no space at all: leaves after MIN_SHOW', () => {
  const b = newBoot(T0);
  onSubscribed(b, [], T0 + 10);
  assert.equal(splash(b, [], T0 + MIN_SHOW).kind, 'leave');
});

test('silent hub: error message after TIMEOUT, splash stays, leaves once the hub answers', () => {
  const b = newBoot(T0);
  assert.equal(splash(b, [], T0 + TIMEOUT - 1).kind, 'wait');
  assert.equal(nextCheck(b, [], T0 + 1000), TIMEOUT - 1000);
  assert.equal(splash(b, [], T0 + TIMEOUT).kind, 'slow');
  assert.equal(splash(b, [], T0 + 60_000).kind, 'slow');
  onSubscribed(b, ['a'], T0 + 60_000);
  assert.equal(splash(b, ['a'], T0 + 60_001).kind, 'wait', 'the late space gets its own TIMEOUT');
  onSynced(b, 'a');
  assert.equal(splash(b, ['a'], T0 + 60_002).kind, 'leave');
});

test('silent space: no longer holds the splash after TIMEOUT, marked unloaded until its synced', () => {
  const b = newBoot(T0);
  onSubscribed(b, ['a', 'slow'], T0 + 100); onSynced(b, 'a');
  assert.deepEqual(unloaded(b, ['a', 'slow'], T0 + 5000), []);
  assert.equal(splash(b, ['a', 'slow'], T0 + 5000).kind, 'wait');
  assert.equal(nextCheck(b, ['a', 'slow'], T0 + 5000), TIMEOUT + 100 - 5000);
  assert.equal(splash(b, ['a', 'slow'], T0 + 100 + TIMEOUT).kind, 'leave');
  b.out = true;
  assert.deepEqual(unloaded(b, ['a', 'slow'], T0 + 100 + TIMEOUT), ['slow']);
  assert.equal(nextCheck(b, ['a', 'slow'], T0 + 100 + TIMEOUT), null, 'nothing left to time: no timer');
  onSynced(b, 'slow');
  assert.deepEqual(unloaded(b, ['a', 'slow'], T0 + 60_000), []);
});

test('gone for good: a reconnection never brings the splash back', () => {
  const b = newBoot(T0);
  onSubscribed(b, ['a'], T0); onSynced(b, 'a'); b.out = true;
  onSubscribed(b, ['a'], T0 + 99_000);
  assert.equal(splash(b, ['a'], T0 + 99_000).kind, 'gone');
});

test('a space asked again on reconnection keeps its first deadline', () => {
  const b = newBoot(T0);
  onSubscribed(b, ['x'], T0);
  onSubscribed(b, ['x', 'y'], T0 + 8000);
  assert.deepEqual(unloaded(b, ['x', 'y'], T0 + TIMEOUT), ['x']);
  assert.deepEqual(unloaded(b, ['x', 'y'], T0 + 8000 + TIMEOUT), ['x', 'y']);
});
