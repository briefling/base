import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from '../src/usage.ts';

const turn = (activity: unknown) => ({ usd: 1, status: 'actual', input: 10, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 3, activity });

test('parseUsage keeps the coordination and review categories, drops an unknown one', () => {
  const u = parseUsage(turn({ coordination: { usd: 0.4, calls: 1 }, review: { usd: 0.5, calls: 1 }, script: { usd: 0.1, calls: 1 } }));
  assert.deepEqual(u?.activity, { coordination: { usd: 0.4, calls: 1 }, review: { usd: 0.5, calls: 1 } });
});

test('parseUsage: an older plugin\'s « delegate » (sub-agents) is stored as other, summed with it', () => {
  const u = parseUsage(turn({ delegate: { usd: 0.3, calls: 2 }, other: { usd: 0.1, calls: 1 }, read: { usd: 0.2, calls: 1 } }));
  assert.deepEqual(u?.activity, { other: { usd: 0.4, calls: 3 }, read: { usd: 0.2, calls: 1 } });
});
