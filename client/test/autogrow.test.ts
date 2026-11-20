import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitHeight } from '../src/autogrow.ts';

test('fitHeight: empty or short text keeps the minimum', () => {
  assert.equal(fitHeight(17, 58, 203), 58);
  assert.equal(fitHeight(0, 48, 136), 48);
});

test('fitHeight: grows with the text between min and max, rounded up', () => {
  assert.equal(fitHeight(120, 58, 203), 120);
  assert.equal(fitHeight(120.2, 58, 203), 121);
});

test('fitHeight: capped at the max, then the field scrolls', () => {
  assert.equal(fitHeight(900, 58, 203), 203);
});

test('fitHeight: max-height none (NaN) or 0 means no cap, a missing min means 0', () => {
  assert.equal(fitHeight(900, 58, NaN), 900);
  assert.equal(fitHeight(900, 58, 0), 900);
  assert.equal(fitHeight(30, NaN, 203), 30);
});
